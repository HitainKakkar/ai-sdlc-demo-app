namespace InvoiceApp.Domain;

/// <summary>
/// Thrown when an approver is not allowed to approve an invoice. Nothing about the invoice has changed.
/// Derives from <see cref="InvalidOperationException"/> so the API maps it to HTTP 409.
/// </summary>
public class ApprovalDeniedException : InvalidOperationException
{
    public ApprovalDeniedException(string message)
        : base(message)
    {
    }
}
