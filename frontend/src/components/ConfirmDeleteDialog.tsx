export function ConfirmDeleteDialog(props: {
  title?: string;
  message?: string;
  deleting?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const {
    title = "Delete report",
    message = "Are you sure you want to delete this report?",
    deleting = false,
    onConfirm,
    onCancel,
  } = props;

  return (
    <div className="modal-overlay modal-overlay--centered" role="dialog" aria-modal="true" aria-label="Confirm delete">
      <div className="modal card confirm-delete-dialog">
        <div className="card-title">{title}</div>
        <p className="text-muted confirm-delete-dialog__message">{message}</p>
        <div className="modal-actions confirm-delete-dialog__actions">
          <button type="button" className="btn-danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete"}
          </button>
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={deleting}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}