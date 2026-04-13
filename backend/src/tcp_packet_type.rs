#[repr(u32)]
#[derive(Debug)]
pub enum PacketType {
    GetMetrics = 4,
    GetMetricsResult = 41
}