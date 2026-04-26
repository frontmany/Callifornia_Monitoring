use std::sync::Arc;

use crate::tcp_packet::Packet;
use anyhow::{Result, anyhow};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::debug;

fn scramble(input_number: u64) -> u64 {
    let mut out = input_number ^ 0xDEADBEEFC_u64;
    out = (out & 0xF0F0F0F0F0F0F0F0_u64) >> 4 | (out & 0x0F0F0F0F0F0F0F0F_u64) << 4;
    out ^ 0xC0DEFACE12345678_u64
}

pub struct TcpClient {
    stream: Arc<tokio::sync::Mutex<Option<TcpStream>>>,
    connected: Arc<std::sync::atomic::AtomicBool>,
}

impl TcpClient {
    pub fn new() -> Self {
        Self {
            stream: Arc::new(tokio::sync::Mutex::new(None)),
            connected: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub async fn connect(&self, address: &str) -> Result<()> {
        if self.connected.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(anyhow!("Already connected"));
        }

        let stream = TcpStream::connect(address).await?;
        let mut guard = self.stream.lock().await;
        *guard = Some(stream);

        self.perform_handshake(guard).await?;

        Ok(())
    }

    pub async fn disconnect(&self) {
        self.connected
            .store(false, std::sync::atomic::Ordering::SeqCst);
        let mut guard = self.stream.lock().await;
        if let Some(ref mut stream) = *guard {
            let _ = stream.shutdown().await;
        }
        *guard = None;
        debug!("Disconnected");
    }

    pub async fn send_packet(&self, packet: Packet) -> Result<()> {
        if !self.connected.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(anyhow!("Handshake not completed"));
        }
        let mut guard = self.stream.lock().await;
        let stream = guard.as_mut().ok_or_else(|| anyhow!("Not connected"))?;

        let mut header = [0u8; 8];
        header[0..4].copy_from_slice(&packet.packet_type.to_le_bytes());
        header[4..8].copy_from_slice(&packet.body_size.to_le_bytes());

        stream.write_all(&header).await?;
        if !packet.body.is_empty() {
            stream.write_all(&packet.body).await?;
        }
        stream.flush().await?;
        Ok(())
    }

    pub async fn receive_packet(&self) -> Result<Packet> {
        if !self.connected.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(anyhow!("Handshake not completed"));
        }
        let mut guard = self.stream.lock().await;
        let stream = guard.as_mut().ok_or_else(|| anyhow!("Not connected"))?;

        let mut header = [0u8; 8];
        stream.read_exact(&mut header).await?;
        let packet_type = u32::from_le_bytes(header[0..4].try_into().unwrap());
        let body_size = u32::from_le_bytes(header[4..8].try_into().unwrap());
        let mut body = vec![0u8; body_size as usize];
        if body_size > 0 {
            stream.read_exact(&mut body).await?;
        }
        Ok(Packet {
            packet_type,
            body_size,
            body,
        })
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(std::sync::atomic::Ordering::SeqCst)
    }

    async fn perform_handshake<'a>(
        &self,
        mut guard: tokio::sync::MutexGuard<'a, Option<TcpStream>>,
    ) -> Result<()> {
        let stream = guard.as_mut().ok_or_else(|| anyhow!("Not connected"))?;

        let mut handshake_in_buf = [0u8; 8];
        stream.read_exact(&mut handshake_in_buf).await?;
        let handshake_in = u64::from_le_bytes(handshake_in_buf);
        debug!("Received handshake: {}", handshake_in);

        let handshake_out = scramble(handshake_in);
        stream.write_all(&handshake_out.to_le_bytes()).await?;
        stream.flush().await?;
        debug!("Sent handshake: {}", handshake_out);

        let mut confirmation_buf = [0u8; 8];
        stream.read_exact(&mut confirmation_buf).await?;
        let confirmation = u64::from_le_bytes(confirmation_buf);
        debug!("Received confirmation: {}", confirmation);

        if confirmation != handshake_out {
            return Err(anyhow!("Handshake validation failed"));
        }
        self.connected
            .store(true, std::sync::atomic::Ordering::SeqCst);
        debug!("Handshake completed successfully");

        Ok(())
    }
}
