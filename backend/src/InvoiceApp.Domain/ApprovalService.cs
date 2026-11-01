using System.Globalization;

namespace InvoiceApp.Domain;

/// <summary>
/// Moves an invoice through its lifecycle: Draft -> PendingApproval -> Approved or Rejected.
/// Approval is limited by role (see <see cref="ApprovalLimits"/>): a Manager up to 50,000.00,
/// a Director up to 500,000.00; other roles cannot approve. Invoices above 500,000.00 need two
/// distinct approvers: the first may be a Manager or a Director, the second must be a different
/// person with the Director role. Limits never apply to rejection.
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
    /// Up to 500,000.00 a single approval within the role's limit approves the invoice.
    /// Above 500,000.00 the first approval (Manager or Director) only records
    /// <see cref="Invoice.FirstApprovedBy"/>/<see cref="Invoice.FirstApprovedAt"/> and the invoice stays
    /// pending; the second approval must come from a different user (trimmed, case-insensitive) who is a
    /// Director, and only then is the invoice approved. Every check runs before the invoice is changed
    /// or saved; a denial throws <see cref="ApprovalDeniedException"/> and leaves the invoice untouched.
    /// A blank approver is rejected with <see cref="ArgumentException"/> before anything else, and a blank
    /// recorded <see cref="Invoice.FirstApprovedBy"/> does not count as a first approval.
    /// </summary>
    public Invoice Approve(string invoiceId, string approver, string approverRole)
    {
        if (string.IsNullOrWhiteSpace(approver))
        {
            throw new ArgumentException("An approver is required.", nameof(approver));
        }

        var invoice = Find(invoiceId);
        EnsurePending(invoice);

        var limit = ApprovalLimits.LimitFor(approverRole);
        if (limit is null)
        {
            throw new ApprovalDeniedException(
                $"Role '{approverRole}' cannot approve invoices. Only a Manager or a Director can approve.");
        }

        if (invoice.Amount > ApprovalLimits.TwoApproverThreshold)
        {
            if (string.IsNullOrWhiteSpace(invoice.FirstApprovedBy))
            {
                invoice.FirstApprovedBy = approver;
                invoice.FirstApprovedAt = DateTime.UtcNow;
                _repository.Update(invoice);
                return invoice;
            }

            if (string.Equals(invoice.FirstApprovedBy.Trim(), approver.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                throw new ApprovalDeniedException(
                    $"{invoice.FirstApprovedBy} already gave the first approval for invoice {invoice.Id}; " +
                    "the second approval must come from a different person.");
            }

            if (approverRole != ApprovalLimits.DirectorRole)
            {
                throw new ApprovalDeniedException(
                    $"The second approval for invoice {invoice.Id} (above {FormatAmount(ApprovalLimits.TwoApproverThreshold)}) " +
                    $"must come from a Director; {approver} is a {approverRole}.");
            }
        }
        else if (invoice.Amount > limit.Value)
        {
            throw new ApprovalDeniedException(
                $"A {approverRole} may approve invoices up to {FormatAmount(limit.Value)}; " +
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
