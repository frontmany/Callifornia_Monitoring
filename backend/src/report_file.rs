use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Relative filename (under REPORTS_DIR) for a report JSON, unique per DB row.
/// Example: `b2d3a5d4-0d5d-4c6d-8b6d-0d5d3c6d8b6d.json`
pub fn report_json_relpath(id: Uuid) -> String {
    format!("{id}.json")
}

/// Resolve what is stored in `reports.file_path` to an absolute path on disk.
/// Storage rule:
/// - store **relative** filename (preferred), resolved against `reports_dir`
/// - if DB contains an absolute path (legacy), use it as-is
pub fn resolve_stored_file_path(reports_dir: &str, stored: &str) -> PathBuf {
    let stored = stored.trim();
    if stored.is_empty() {
        return PathBuf::new();
    }
    let p = Path::new(stored);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        Path::new(reports_dir).join(p)
    }
}
