using System.Globalization;

namespace InvoiceApp.Domain;

/// <summary>
/// Moves an invoice through its lifecycle: Draft -> PendingApproval -> Approved or Rejected.
/// Approval is limited by role (see <see cref="ApprovalLimits"/>): a Manager up to 50,000.00,
/// a Director up to 500,000.00; other roles cannot approve. Limits never apply to rejection.
/// </summary>
public class ApprovalService
{
    private readonly IInvoiceRepository _repository;

    public ApprovalService(IInvoiceRepository repository)
    {
        _repository = repository;
    }

    public Invoice Submit(string invoiceId)
    {
        var invoice = Find(invoiceId);

        if (invoice.Status != InvoiceStatus.Draft)
        {
            throw new InvalidOperationException(
                $"Invoice {invoiceId} is {invoice.Status}; only drafts can be submitted.");
        }

        invoice.Status = InvoiceStatus.PendingApproval;
        _repository.Update(invoice);
        return invoice;
    }

    /// <summary>
    /// Approves a pending invoice if the approver's role allows it (see <see cref="ApprovalLimits"/>).
    /// Every check runs before the invoice is changed or saved; a denial throws
    /// <see cref="ApprovalDeniedException"/> and leaves the invoice untouched.
    /// </summary>
    public Invoice Approve(string invoiceId, string approver, string approverRole)
    {
        var invoice = Find(invoiceId);
        EnsurePending(invoice);

        var limit = ApprovalLimits.LimitFor(approverRole)
            ?? throw new ApprovalDeniedException(
                $"Role '{approverRole}' cannot approve invoices. Only a Manager or a Director can approve.");

        if (invoice.Amount > ApprovalLimits.TwoApproverThreshold)
        {
            throw new ApprovalDeniedException(
                $"Invoice {invoice.Id} is {FormatAmount(invoice.Amount)}, above {FormatAmount(ApprovalLimits.TwoApproverThreshold)}, " +
                "and needs two approvers; two-approver approval is not available yet.");
        }

        if (invoice.Amount > limit)
        {
            throw new ApprovalDeniedException(
                $"A {approverRole} may approve invoices up to {FormatAmount(limit)}; " +
                $"invoice {invoice.Id} is {FormatAmount(invoice.Amount)}. A Director must approve it.");
        }

        invoice.Status = InvoiceStatus.Approved;
        invoice.DecidedBy = approver;
        invoice.DecidedAt = DateTime.UtcNow;
        _repository.Update(invoice);
        return invoice;
    }

    public Invoice Reject(string invoiceId, string approver, string reason)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("A reason is required to reject an invoice.", nameof(reason));
        }

        var invoice = Find(invoiceId);
        EnsurePending(invoice);

        invoice.Status = InvoiceStatus.Rejected;
        invoice.DecidedBy = approver;
        invoice.DecidedAt = DateTime.UtcNow;
        invoice.DecisionNote = reason;
        _repository.Update(invoice);
        return invoice;
    }

    private static string FormatAmount(decimal amount) =>
        amount.ToString("N2", CultureInfo.InvariantCulture);

    private Invoice Find(string invoiceId) =>
        _repository.GetById(invoiceId)
        ?? throw new KeyNotFoundException($"Invoice {invoiceId} was not found.");

    private static void EnsurePending(Invoice invoice)
    {
        if (invoice.Status != InvoiceStatus.PendingApproval)
        {
            throw new InvalidOperationException(
                $"Invoice {invoice.Id} is {invoice.Status}; only pending invoices can be decided.");
        }
    }
}
