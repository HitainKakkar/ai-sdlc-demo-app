namespace InvoiceApp.Domain;

/// <summary>
/// Approval limits per role. A Manager may approve up to 50,000.00 and a Director up to 500,000.00
/// (both inclusive). Any other role (including Admin) has no approval authority.
/// Invoices above <see cref="TwoApproverThreshold"/> need two approvers.
/// </summary>
public static class ApprovalLimits
{
    public const decimal ManagerLimit = 50_000m;
    public const decimal DirectorLimit = 500_000m;
    public const decimal TwoApproverThreshold = 500_000m;

    public const string ManagerRole = "Manager";
    public const string DirectorRole = "Director";

    /// <summary>
    /// Returns the highest amount the role may approve alone, or <c>null</c> when the role cannot approve.
    /// Role names are matched exactly as configured.
    /// </summary>
    public static decimal? LimitFor(string? role) => role switch
    {
        ManagerRole => ManagerLimit,
        DirectorRole => DirectorLimit,
        _ => null,
    };
}
