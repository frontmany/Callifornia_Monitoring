#[derive(Debug, Clone)]
pub struct Packet {
    pub packet_type: u32,
    pub body_size: u32,
    pub body: Vec<u8>,
}

impl Packet {
    pub fn new(packet_type: u32, body: Vec<u8>) -> Self {
        let body_size = body.len() as u32;

        Self {
            packet_type,
            body_size,
            body,
        }
    }
}
