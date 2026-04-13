use std::io;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use tokio::time;
use tracing::{info, error, warn, debug};
use anyhow::{Result, anyhow};
use crate::tcp_packet::Packet;
use crate::tcp_packet_type::PacketType;
use crate::tcp_client::TcpClient;

fn is_connection_error(e: &anyhow::Error) -> bool {
    if let Some(io_err) = e.downcast_ref::<io::Error>() {
        use io::ErrorKind;
        matches!(
            io_err.kind(),
            ErrorKind::ConnectionReset
                | ErrorKind::ConnectionAborted
                | ErrorKind::BrokenPipe
                | ErrorKind::UnexpectedEof
        )
    } else {
        false
    }
}

const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const RECONNECT_DELAY: Duration = Duration::from_secs(5);

pub enum ReconnectResult {
    Reconnected,
    Shutdown,
}

pub struct DataRequester {
    server_addr: String,
    client: Arc<TcpClient>,
    interval_secs: u64,
    recv_callback: Arc<dyn Fn(Vec<u8>) + Send + Sync>,
    status_callback: Arc<dyn Fn(bool, Option<String>) + Send + Sync>,
    shutdown_tx: broadcast::Sender<()>,
    is_running: Arc<std::sync::atomic::AtomicBool>,
}

impl DataRequester {
    pub fn new<F, S>(
        server_addr: &str,
        interval_secs: u64,
        callback: F,
        status_callback: S,
    ) -> Self
    where
        F: Fn(Vec<u8>) + Send + Sync + 'static,
        S: Fn(bool, Option<String>) + Send + Sync + 'static,
    {
        let (shutdown_tx, _) = broadcast::channel(1);
        Self {
            server_addr: server_addr.to_string(),
            client: Arc::new(TcpClient::new()),
            interval_secs,
            recv_callback: Arc::new(callback),
            status_callback: Arc::new(status_callback),
            shutdown_tx,
            is_running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub async fn start(&self) -> Result<()> {
        if self.is_running.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return Err(anyhow!("Data requester already running"));
        }
        
        let client = self.client.clone();
        let recv_callback = self.recv_callback.clone();
        let interval_secs = self.interval_secs;
        let is_running = self.is_running.clone();
        let server_addr = self.server_addr.clone();
        let status_callback = self.status_callback.clone();
        let mut shutdown_rx = self.shutdown_tx.subscribe();
        
        info!("Starting data requester for {} with interval {} seconds", server_addr, interval_secs);
        
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(interval_secs));
            let mut last_reported_connected = false;
            
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        if !client.is_connected() {
                            if last_reported_connected {
                                (status_callback)(false, Some("disconnected".to_string()));
                                last_reported_connected = false;
                            }
                            match Self::try_reconnect(&client, &server_addr, &mut shutdown_rx).await {
                                ReconnectResult::Reconnected => {
                                    if !last_reported_connected {
                                        (status_callback)(true, None);
                                        last_reported_connected = true;
                                    }
                                }
                                ReconnectResult::Shutdown => {
                                    info!("Shutdown during reconnect");
                                    is_running.store(false, std::sync::atomic::Ordering::SeqCst);
                                    if last_reported_connected {
                                        (status_callback)(false, Some("shutdown".to_string()));
                                    }
                                    return;
                                }
                            }
                            continue;
                        }

                        match Self::request_with_timeout(&client).await {
                            Ok(Some(data)) => {
                                debug!("Received data, size: {}", data.len());
                                if !last_reported_connected {
                                    (status_callback)(true, None);
                                    last_reported_connected = true;
                                }
                                recv_callback(data);
                            }
                            Ok(None) => {
                                warn!("Request timeout for {}", server_addr);
                            }
                            Err(e) => {
                                error!("Failed to get data from {}: {}", server_addr, e);
                                if is_connection_error(&e) {
                                    warn!("Connection lost, will reconnect on next tick");
                                    if last_reported_connected {
                                        (status_callback)(false, Some(e.to_string()));
                                        last_reported_connected = false;
                                    }
                                    client.disconnect().await;
                                }
                            }
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        info!("Data requester for {} shutting down", server_addr);
                        if last_reported_connected {
                            (status_callback)(false, Some("shutdown".to_string()));
                        }
                        break;
                    }
                }
            }
            
            is_running.store(false, std::sync::atomic::Ordering::SeqCst);
        });
        
        Ok(())
    }
    
    pub async fn stop(&self) {
        self.is_running.store(false, std::sync::atomic::Ordering::SeqCst);
        let _ = self.shutdown_tx.send(());
        info!("Stopping data requester for {}", self.server_addr);
    }

    async fn try_reconnect(
        client: &TcpClient,
        server_addr: &str,
        shutdown_rx: &mut broadcast::Receiver<()>,
    ) -> ReconnectResult {
        warn!("Client disconnected, trying to reconnect to {}...", server_addr);
        loop {
            match client.connect(server_addr).await {
                Ok(()) => {
                    info!("Reconnected to {}", server_addr);
                    return ReconnectResult::Reconnected;
                }
                Err(e) => {
                    error!("Reconnect to {} failed: {}", server_addr, e);
                    tokio::select! {
                        _ = time::sleep(RECONNECT_DELAY) => {}
                        _ = shutdown_rx.recv() => return ReconnectResult::Shutdown,
                    }
                }
            }
        }
    }

    async fn request_with_timeout(client: &TcpClient) -> Result<Option<Vec<u8>>> {
        match time::timeout(REQUEST_TIMEOUT, Self::request_and_receive_data(client)).await {
            Ok(Ok(data)) => Ok(Some(data)),
            Ok(Err(e)) => Err(e),
            Err(_) => Ok(None),
        }
    }
    
    async fn request_and_receive_data(client: &TcpClient) -> Result<Vec<u8>> {
        let request_packet = Packet::new(PacketType::GetMetrics as u32, Vec::new());
        client.send_packet(request_packet).await?;
        debug!("Data request sent");
        
        let response = client.receive_packet().await?;
        
        if response.packet_type != PacketType::GetMetricsResult as u32 {
            return Err(anyhow!("Unexpected packet type: {}, expected: {}",
                response.packet_type, PacketType::GetMetricsResult as u32));
        }
        
        Ok(response.body)
    }
}