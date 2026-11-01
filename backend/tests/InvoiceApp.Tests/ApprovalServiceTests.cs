using System.Globalization;
using InvoiceApp.Domain;
using Xunit;

namespace InvoiceApp.Tests;

public class ApprovalServiceTests
{
    private const string NoAuthorityTail = "Only a Manager or a Director can approve.";

    /// <summary>Concrete first-approval timestamp seeded before second-approval / reject tests.</summary>
    private static readonly DateTime SeededFirstApprovedAt = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    /// <summary>Prior decision timestamp; deliberately different from <see cref="SeededFirstApprovedAt"/> so a field swap is visible.</summary>
    private static readonly DateTime SeededDecidedAt = new(2026, 1, 2, 8, 30, 0, DateTimeKind.Utc);

    private static Invoice InvoiceWith(string id, InvoiceStatus status) =>
        new() { Id = id, CustomerName = "Test School", Amount = 100m, Status = status };

    private static Invoice PendingInvoice(string id, decimal amount) =>
        new() { Id = id, CustomerName = "Test School", Amount = amount, Status = InvoiceStatus.PendingApproval };

    /// <summary>A pending invoice that already carries a first approval by <paramref name="firstApprover"/>.</summary>
    private static Invoice PendingInvoiceWithFirstApproval(string id, decimal amount, string firstApprover)
    {
        var invoice = PendingInvoice(id, amount);
        invoice.FirstApprovedBy = firstApprover;
        invoice.FirstApprovedAt = SeededFirstApprovedAt;
        return invoice;
    }

    /// <summary>
    /// Every one of the six decision fields is non-null, so a "clear the old values, then throw"
    /// bug is visible in the snapshot. The first approval is by <c>demo.director</c>.
    /// </summary>
    private static Invoice PendingInvoiceWithPriorDecisionData(string id, decimal amount)
    {
        var invoice = PendingInvoiceWithFirstApproval(id, amount, "demo.director");
        invoice.DecisionNote = "prior note";
        invoice.DecidedBy = "someone.else";
        invoice.DecidedAt = SeededDecidedAt;
        return invoice;
    }

    private static ApprovalService ServiceFor(params Invoice[] invoices) =>
        new(new FakeInvoiceRepository(invoices));

    private static (InvoiceStatus Status, string? DecidedBy, DateTime? DecidedAt, string? DecisionNote, string? FirstApprovedBy, DateTime? FirstApprovedAt) DecisionFields(Invoice invoice) =>
        (invoice.Status, invoice.DecidedBy, invoice.DecidedAt, invoice.DecisionNote, invoice.FirstApprovedBy, invoice.FirstApprovedAt);

    // ---------------------------------------------------------------------
    // Existing lifecycle tests (adapted to Approve(invoiceId, approver, approverRole))
    // ---------------------------------------------------------------------

    [Fact]
    public void Submit_MovesDraftToPendingApproval()
    {
        var invoice = InvoiceWith("INV-1", InvoiceStatus.Draft);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);

        var result = service.Submit("INV-1");

        Assert.Equal(InvoiceStatus.PendingApproval, result.Status);
        Assert.Equal(1, repository.UpdateCalls);
    }

    [Fact]
    public void Submit_RejectsInvoiceThatIsNotADraft()
    {
        var invoice = InvoiceWith("INV-1", InvoiceStatus.Approved);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);

        var ex = Assert.Throws<InvalidOperationException>(() => service.Submit("INV-1"));

        Assert.Contains("INV-1", ex.Message);
        Assert.Equal(InvoiceStatus.Approved, invoice.Status);
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_SetsStatusApproverAndTimestamp()
    {
        var invoice = InvoiceWith("INV-1", InvoiceStatus.PendingApproval);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);

        var result = service.Approve("INV-1", "demo.manager", "Manager");

        Assert.Equal(InvoiceStatus.Approved, result.Status);
        Assert.Equal("demo.manager", result.DecidedBy);
        Assert.NotNull(result.DecidedAt);
        Assert.Equal(1, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_RejectsInvoiceThatIsStillADraft()
    {
        var invoice = InvoiceWith("INV-1", InvoiceStatus.Draft);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<InvalidOperationException>(() => service.Approve("INV-1", "demo.manager", "Manager"));

        Assert.Equal(typeof(InvalidOperationException), ex.GetType());
        Assert.Contains("INV-1", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_ThrowsWhenInvoiceDoesNotExist()
    {
        var service = ServiceFor();

        var ex = Assert.Throws<KeyNotFoundException>(() => service.Approve("INV-404", "demo.manager", "Manager"));

        Assert.Contains("INV-404", ex.Message);
    }

    [Fact]
    public void Reject_RecordsReasonAndApprover()
    {
        var invoice = InvoiceWith("INV-1", InvoiceStatus.PendingApproval);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);

        var result = service.Reject("INV-1", "demo.manager", "Duplicate invoice");

        Assert.Equal(InvoiceStatus.Rejected, result.Status);
        Assert.Equal("Duplicate invoice", result.DecisionNote);
        Assert.Equal("demo.manager", result.DecidedBy);
        Assert.NotNull(result.DecidedAt);
        Assert.Equal(1, repository.UpdateCalls);
    }

    [Fact]
    public void Reject_RequiresAReason()
    {
        var invoice = InvoiceWith("INV-1", InvoiceStatus.PendingApproval);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);

        var ex = Assert.Throws<ArgumentException>(() => service.Reject("INV-1", "demo.manager", "  "));

        Assert.Contains("reason is required", ex.Message);
        Assert.Equal(InvoiceStatus.PendingApproval, invoice.Status);
        Assert.Equal(0, repository.UpdateCalls);
    }

    // ---------------------------------------------------------------------
    // Lifecycle gaps from the BEFORE mutation baseline
    // ---------------------------------------------------------------------

    [Fact]
    public void Approve_NotPendingInvoice_ThrowsNotPendingErrorWithInvoiceIdAndChangesNothing()
    {
        var invoice = InvoiceWith("INV-1", InvoiceStatus.Rejected);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<InvalidOperationException>(() => service.Approve("INV-1", "demo.manager", "Manager"));

        Assert.Equal(typeof(InvalidOperationException), ex.GetType());
        Assert.Contains("INV-1", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_NotPendingInvoiceByRoleWithoutAuthority_ThrowsNotPendingErrorNotDenial()
    {
        var invoice = InvoiceWith("INV-1", InvoiceStatus.Draft);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<InvalidOperationException>(() => service.Approve("INV-1", "demo.admin", "Admin"));

        Assert.Equal(typeof(InvalidOperationException), ex.GetType());
        Assert.Contains("INV-1", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_NotPendingInvoiceAboveManagerLimit_ThrowsNotPendingErrorNotDenial()
    {
        var invoice = PendingInvoice("INV-1", 75_000.00m);
        invoice.Status = InvoiceStatus.Approved;
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<InvalidOperationException>(() => service.Approve("INV-1", "demo.manager", "Manager"));

        Assert.Equal(typeof(InvalidOperationException), ex.GetType());
        Assert.Contains("INV-1", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_NotPendingInvoiceAboveTwoApproverThreshold_ThrowsNotPendingErrorNotDenial()
    {
        var invoice = PendingInvoice("INV-1", 750_000.00m);
        invoice.Status = InvoiceStatus.Approved;
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<InvalidOperationException>(() => service.Approve("INV-1", "demo.director", "Director"));

        Assert.Equal(typeof(InvalidOperationException), ex.GetType());
        Assert.Contains("INV-1", ex.Message);
        Assert.DoesNotContain("two approvers", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_NotPendingInvoiceWithFirstApprovalBySameUser_ThrowsNotPendingErrorNotSameUserDenial()
    {
        var invoice = PendingInvoiceWithFirstApproval("INV-1", 750_000.00m, "demo.director");
        invoice.Status = InvoiceStatus.Approved;
        invoice.DecidedBy = "demo.director2";
        invoice.DecidedAt = SeededDecidedAt;
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<InvalidOperationException>(() => service.Approve("INV-1", "demo.director", "Director"));

        Assert.Equal(typeof(InvalidOperationException), ex.GetType());
        Assert.Contains("INV-1", ex.Message);
        Assert.DoesNotContain("first approval", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_MissingInvoiceByRoleWithoutAuthority_ThrowsNotFound()
    {
        var service = ServiceFor();

        var ex = Assert.Throws<KeyNotFoundException>(() => service.Approve("INV-404", "demo.admin", "Admin"));

        Assert.Contains("INV-404", ex.Message);
    }

    [Fact]
    public void Reject_NotPendingInvoice_ThrowsNotPendingErrorAndChangesNothing()
    {
        var invoice = InvoiceWith("INV-1", InvoiceStatus.Approved);
        invoice.DecidedBy = "demo.director";
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<InvalidOperationException>(() => service.Reject("INV-1", "demo.manager", "Duplicate"));

        Assert.Equal(typeof(InvalidOperationException), ex.GetType());
        Assert.Contains("INV-1", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Reject_MissingInvoice_ThrowsNotFoundWithInvoiceId()
    {
        var service = ServiceFor();

        var ex = Assert.Throws<KeyNotFoundException>(() => service.Reject("INV-404", "demo.manager", "Duplicate"));

        Assert.Contains("INV-404", ex.Message);
    }

    [Fact]
    public void Approve_Success_SetsDecidedAtToCurrentUtcTime()
    {
        var invoice = PendingInvoice("INV-1", 100.00m);
        var service = ServiceFor(invoice);
        var start = DateTime.UtcNow;

        service.Approve("INV-1", "demo.manager", "Manager");

        Assert.NotNull(invoice.DecidedAt);
        Assert.Equal(DateTimeKind.Utc, invoice.DecidedAt!.Value.Kind);
        Assert.InRange(invoice.DecidedAt.Value, start, DateTime.UtcNow);
    }

    [Fact]
    public void Reject_Success_SetsDecidedAtToCurrentUtcTime()
    {
        var invoice = PendingInvoice("INV-1", 100.00m);
        var service = ServiceFor(invoice);
        var start = DateTime.UtcNow;

        service.Reject("INV-1", "demo.manager", "Duplicate");

        Assert.NotNull(invoice.DecidedAt);
        Assert.Equal(DateTimeKind.Utc, invoice.DecidedAt!.Value.Kind);
        Assert.InRange(invoice.DecidedAt.Value, start, DateTime.UtcNow);
    }

    // ---------------------------------------------------------------------
    // R1: Manager may approve up to 50,000.00 (inclusive)
    // ---------------------------------------------------------------------

    public static TheoryData<decimal> ManagerAllowedAmounts => new() { 49_999.99m, 50_000.00m };

    [Theory, MemberData(nameof(ManagerAllowedAmounts))]
    public void Approve_ManagerAtOrBelowLimit_Approves(decimal amount)
    {
        var invoice = PendingInvoice("INV-1", amount);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);

        var result = service.Approve("INV-1", "demo.manager", "Manager");

        Assert.Same(invoice, result);
        Assert.Equal(InvoiceStatus.Approved, invoice.Status);
        Assert.Equal("demo.manager", invoice.DecidedBy);
        Assert.NotNull(invoice.DecidedAt);
        Assert.Null(invoice.DecisionNote);
        Assert.Null(invoice.FirstApprovedBy);
        Assert.Null(invoice.FirstApprovedAt);
        Assert.Equal(1, repository.UpdateCalls);
    }

    public static TheoryData<decimal, string> ManagerDeniedAmounts => new()
    {
        { 50_000.01m, "A Manager may approve invoices up to 50,000.00; invoice INV-1 is 50,000.01. A Director must approve it." },
        { 75_000.00m, "A Manager may approve invoices up to 50,000.00; invoice INV-1 is 75,000.00. A Director must approve it." },
        { 500_000.00m, "A Manager may approve invoices up to 50,000.00; invoice INV-1 is 500,000.00. A Director must approve it." },
    };

    [Theory, MemberData(nameof(ManagerDeniedAmounts))]
    public void Approve_ManagerAboveLimit_DeniesAndLeavesInvoiceUnchanged(decimal amount, string expectedMessage)
    {
        var invoice = PendingInvoice("INV-1", amount);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.manager", "Manager"));

        Assert.Contains("50,000.00", ex.Message);
        Assert.Contains("INV-1", ex.Message);
        Assert.Contains("Manager", ex.Message);
        Assert.Equal(expectedMessage, ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(InvoiceStatus.PendingApproval, invoice.Status);
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_ManagerAboveLimitUnderCommaDecimalCulture_FormatsAmountsInvariantly()
    {
        var invoice = PendingInvoice("INV-1", 75_000.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);
        using var culture = new CultureScope("de-DE");

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.manager", "Manager"));

        Assert.Contains("50,000.00", ex.Message);
        Assert.Contains("75,000.00", ex.Message);
        Assert.Contains("INV-1", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    // ---------------------------------------------------------------------
    // R2: Director may approve alone up to 500,000.00 (inclusive)
    // ---------------------------------------------------------------------

    public static TheoryData<decimal> DirectorAllowedAmounts => new() { 50_000.01m, 75_000.00m, 500_000.00m };

    [Theory, MemberData(nameof(DirectorAllowedAmounts))]
    public void Approve_DirectorAtOrBelowLimit_ApprovesAlone(decimal amount)
    {
        var invoice = PendingInvoice("INV-1", amount);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);

        var result = service.Approve("INV-1", "demo.director", "Director");

        Assert.Same(invoice, result);
        Assert.Equal(InvoiceStatus.Approved, invoice.Status);
        Assert.Equal("demo.director", invoice.DecidedBy);
        Assert.NotNull(invoice.DecidedAt);
        Assert.Null(invoice.FirstApprovedBy);
        Assert.Null(invoice.FirstApprovedAt);
        Assert.Equal(1, repository.UpdateCalls);
    }

    // ---------------------------------------------------------------------
    // R2 + R3: above 500,000.00 the first approval (Manager or Director) only records itself
    // ---------------------------------------------------------------------

    public static TheoryData<string, string, decimal> FirstApprovalAttempts => new()
    {
        { "demo.manager", "Manager", 500_000.01m },
        { "demo.manager", "Manager", 750_000.00m },
        { "demo.director", "Director", 500_000.01m },
        { "demo.director", "Director", 750_000.00m },
    };

    [Theory, MemberData(nameof(FirstApprovalAttempts))]
    public void Approve_AboveTwoApproverThresholdWithoutFirstApproval_RecordsFirstApprovalAndStaysPending(
        string approver, string role, decimal amount)
    {
        var invoice = PendingInvoice("INV-1", amount);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var start = DateTime.UtcNow;

        var result = service.Approve("INV-1", approver, role);

        Assert.Same(invoice, result);
        Assert.Equal(InvoiceStatus.PendingApproval, invoice.Status);
        Assert.Equal(approver, invoice.FirstApprovedBy);
        Assert.NotNull(invoice.FirstApprovedAt);
        Assert.Equal(DateTimeKind.Utc, invoice.FirstApprovedAt!.Value.Kind);
        Assert.InRange(invoice.FirstApprovedAt.Value, start, DateTime.UtcNow);
        Assert.Null(invoice.DecidedBy);
        Assert.Null(invoice.DecidedAt);
        Assert.Null(invoice.DecisionNote);
        Assert.Equal(1, repository.UpdateCalls);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Approve_AboveTwoApproverThresholdWithBlankRecordedFirstApprover_RecordsNewFirstApprovalAndStaysPending(
        string blankFirstApprover)
    {
        var invoice = PendingInvoiceWithFirstApproval("INV-1", 750_000.00m, blankFirstApprover);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var start = DateTime.UtcNow;

        var result = service.Approve("INV-1", "demo.director", "Director");

        Assert.Same(invoice, result);
        Assert.Equal(InvoiceStatus.PendingApproval, invoice.Status);
        Assert.Null(invoice.DecidedBy);
        Assert.Null(invoice.DecidedAt);
        Assert.Equal("demo.director", invoice.FirstApprovedBy);
        Assert.NotNull(invoice.FirstApprovedAt);
        Assert.NotEqual(SeededFirstApprovedAt, invoice.FirstApprovedAt);
        Assert.Equal(DateTimeKind.Utc, invoice.FirstApprovedAt!.Value.Kind);
        Assert.InRange(invoice.FirstApprovedAt.Value, start, DateTime.UtcNow);
        Assert.Equal(1, repository.UpdateCalls);
    }

    // ---------------------------------------------------------------------
    // Blank approver name: rejected before any rule runs (D-40)
    // ---------------------------------------------------------------------

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Approve_BlankApprover_ThrowsArgumentExceptionAndLeavesInvoiceUnchanged(string? approver)
    {
        var invoice = PendingInvoice("INV-1", 100.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ArgumentException>(() => service.Approve("INV-1", approver!, "Director"));

        Assert.Contains("approver is required", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(InvoiceStatus.PendingApproval, invoice.Status);
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_BlankApproverAboveTwoApproverThreshold_ThrowsAndDoesNotRecordFirstApproval()
    {
        var invoice = PendingInvoice("INV-1", 750_000.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ArgumentException>(() => service.Approve("INV-1", "   ", "Director"));

        Assert.Contains("approver is required", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Null(invoice.FirstApprovedBy);
        Assert.Null(invoice.FirstApprovedAt);
        Assert.Equal(0, repository.UpdateCalls);
    }

    // ---------------------------------------------------------------------
    // R3: the second approval by a different Director approves; the first approval is kept
    // ---------------------------------------------------------------------

    public static TheoryData<string, string, decimal> SecondApprovalByDifferentDirector => new()
    {
        { "demo.director", "demo.director2", 750_000.00m },
        { "demo.manager", "demo.director", 750_000.00m },
        { "demo.manager", "demo.director", 500_000.01m },
        { "demo.director", "demo.director2", 500_000.01m },
        { "demo.director2", "demo.director", 750_000.00m },
    };

    [Theory, MemberData(nameof(SecondApprovalByDifferentDirector))]
    public void Approve_SecondApprovalByDifferentDirector_ApprovesAndKeepsFirstApproval(
        string firstApprover, string secondApprover, decimal amount)
    {
        var invoice = PendingInvoiceWithFirstApproval("INV-1", amount, firstApprover);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var start = DateTime.UtcNow;

        var result = service.Approve("INV-1", secondApprover, "Director");

        Assert.Same(invoice, result);
        Assert.Equal(InvoiceStatus.Approved, invoice.Status);
        Assert.Equal(secondApprover, invoice.DecidedBy);
        Assert.NotNull(invoice.DecidedAt);
        Assert.Equal(DateTimeKind.Utc, invoice.DecidedAt!.Value.Kind);
        Assert.InRange(invoice.DecidedAt.Value, start, DateTime.UtcNow);
        Assert.Equal(firstApprover, invoice.FirstApprovedBy);
        Assert.Equal(SeededFirstApprovedAt, invoice.FirstApprovedAt);
        Assert.Null(invoice.DecisionNote);
        Assert.Equal(1, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_ManagerFirstThenDifferentDirector_ApprovesAfterTwoCalls()
    {
        var invoice = PendingInvoice("INV-1", 750_000.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        service.Approve("INV-1", "demo.manager", "Manager");
        var firstApprovedAt = invoice.FirstApprovedAt;

        var result = service.Approve("INV-1", "demo.director", "Director");

        Assert.Same(invoice, result);
        Assert.Equal(InvoiceStatus.Approved, invoice.Status);
        Assert.Equal("demo.director", invoice.DecidedBy);
        Assert.NotNull(invoice.DecidedAt);
        Assert.Equal("demo.manager", invoice.FirstApprovedBy);
        Assert.NotNull(firstApprovedAt);
        Assert.Equal(firstApprovedAt, invoice.FirstApprovedAt);
        Assert.Equal(2, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_SameDirectorTwiceInARow_SecondCallIsDeniedAndFirstApprovalKept()
    {
        var invoice = PendingInvoice("INV-1", 750_000.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        service.Approve("INV-1", "demo.director", "Director");
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.director", "Director"));

        Assert.Equal("demo.director already gave the first approval for invoice INV-1; the second approval must come from a different person.", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(InvoiceStatus.PendingApproval, invoice.Status);
        Assert.Equal("demo.director", invoice.FirstApprovedBy);
        Assert.Null(invoice.DecidedBy);
        Assert.Null(invoice.DecidedAt);
        Assert.Equal(1, repository.UpdateCalls);
    }

    // ---------------------------------------------------------------------
    // R4: the same user never counts as both approvers (trimmed, case-insensitive)
    // ---------------------------------------------------------------------

    [Theory]
    [InlineData("demo.director")]
    [InlineData("Demo.Director")]
    [InlineData(" demo.director ")]
    [InlineData("DEMO.DIRECTOR")]
    [InlineData("\tdemo.director")]
    public void Approve_SecondApprovalBySameDirector_DeniesWithSameUserReasonAndLeavesInvoiceUnchanged(string approverAsSent)
    {
        var invoice = PendingInvoiceWithFirstApproval("INV-1", 750_000.00m, "demo.director");
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", approverAsSent, "Director"));

        Assert.Contains("demo.director", ex.Message);
        Assert.Contains("INV-1", ex.Message);
        Assert.Contains("different person", ex.Message);
        Assert.Equal("demo.director already gave the first approval for invoice INV-1; the second approval must come from a different person.", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(InvoiceStatus.PendingApproval, invoice.Status);
        Assert.Equal("demo.director", invoice.FirstApprovedBy);
        Assert.Equal(SeededFirstApprovedAt, invoice.FirstApprovedAt);
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_SameUserDifferentCaseUnderTurkishCulture_DeniesWithSameUserReason()
    {
        var invoice = PendingInvoiceWithFirstApproval("INV-1", 750_000.00m, "demo.director");
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);
        using var culture = new CultureScope("tr-TR");

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "DEMO.DIRECTOR", "Director"));

        Assert.Equal("demo.director already gave the first approval for invoice INV-1; the second approval must come from a different person.", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(InvoiceStatus.PendingApproval, invoice.Status);
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_SameUserWhenStoredFirstApproverHasDifferentCase_DeniesNamingTheStoredUser()
    {
        var invoice = PendingInvoiceWithFirstApproval("INV-1", 500_000.01m, "Demo.Director");
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.director", "Director"));

        Assert.Equal("Demo.Director already gave the first approval for invoice INV-1; the second approval must come from a different person.", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_SameUserWhenStoredFirstApproverHasSurroundingSpaces_DeniesWithSameUserReason()
    {
        var invoice = PendingInvoiceWithFirstApproval("INV-1", 750_000.00m, " demo.director ");
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.director", "Director"));

        Assert.Contains("demo.director", ex.Message);
        Assert.Contains("already gave the first approval for invoice INV-1; the second approval must come from a different person.", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(InvoiceStatus.PendingApproval, invoice.Status);
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_ManagerRepeatingOwnFirstApproval_DeniesWithSameUserReasonNotDirectorReason()
    {
        var invoice = PendingInvoiceWithFirstApproval("INV-1", 750_000.00m, "demo.manager");
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.manager", "Manager"));

        Assert.Equal("demo.manager already gave the first approval for invoice INV-1; the second approval must come from a different person.", ex.Message);
        Assert.DoesNotContain("must come from a Director", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(InvoiceStatus.PendingApproval, invoice.Status);
        Assert.Equal("demo.manager", invoice.FirstApprovedBy);
        Assert.Equal(SeededFirstApprovedAt, invoice.FirstApprovedAt);
        Assert.Equal(0, repository.UpdateCalls);
    }

    // ---------------------------------------------------------------------
    // R3: the second approver must be a Director
    // ---------------------------------------------------------------------

    public static TheoryData<string, decimal> FirstApproversForManagerSecond => new()
    {
        { "demo.director", 750_000.00m },
        { "demo.director", 500_000.01m },
        { "demo.manager2", 750_000.00m },
    };

    [Theory, MemberData(nameof(FirstApproversForManagerSecond))]
    public void Approve_SecondApprovalByDifferentManager_DeniesWithDirectorRequiredReasonAndLeavesInvoiceUnchanged(
        string firstApprover, decimal amount)
    {
        var invoice = PendingInvoiceWithFirstApproval("INV-1", amount, firstApprover);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.manager", "Manager"));

        Assert.Contains("500,000.00", ex.Message);
        Assert.Contains("INV-1", ex.Message);
        Assert.Contains("demo.manager", ex.Message);
        Assert.Contains("Director", ex.Message);
        Assert.Equal("The second approval for invoice INV-1 (above 500,000.00) must come from a Director; demo.manager is a Manager.", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(InvoiceStatus.PendingApproval, invoice.Status);
        Assert.Equal(firstApprover, invoice.FirstApprovedBy);
        Assert.Equal(SeededFirstApprovedAt, invoice.FirstApprovedAt);
        Assert.Equal(0, repository.UpdateCalls);
    }

    // ---------------------------------------------------------------------
    // Authority: only Manager and Director may approve (exact-case role names)
    // ---------------------------------------------------------------------

    [Fact]
    public void Approve_AdminRole_DeniesWithNoAuthorityReason()
    {
        var invoice = PendingInvoice("INV-1", 100.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.admin", "Admin"));

        Assert.Equal("Role 'Admin' cannot approve invoices. Only a Manager or a Director can approve.", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("Approver")]
    [InlineData("manager")]
    [InlineData("director")]
    [InlineData(" Manager")]
    public void Approve_RoleWithoutAuthority_DeniesNamingTheRoleAndLeavesInvoiceUnchanged(string role)
    {
        var invoice = PendingInvoice("INV-1", 100.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.user", role));

        Assert.Contains($"'{role}'", ex.Message);
        Assert.Contains(NoAuthorityTail, ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(InvoiceStatus.PendingApproval, invoice.Status);
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_EmptyRole_DeniesWithNoAuthorityReason()
    {
        var invoice = PendingInvoice("INV-1", 100.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.user", ""));

        Assert.Contains(NoAuthorityTail, ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_AdminAboveTwoApproverThreshold_GetsNoAuthorityReasonNotTwoApproverReason()
    {
        var invoice = PendingInvoice("INV-1", 750_000.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.admin", "Admin"));

        Assert.Equal("Role 'Admin' cannot approve invoices. Only a Manager or a Director can approve.", ex.Message);
        Assert.DoesNotContain("two approvers", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Theory]
    [InlineData("demo.admin", "Admin")]
    [InlineData("demo.director", "Admin")]
    [InlineData("demo.director2", "director")]
    public void Approve_RoleWithoutAuthorityOnFirstApprovedInvoice_GetsNoAuthorityReasonNotSecondApprovalReason(
        string approver, string role)
    {
        var invoice = PendingInvoiceWithFirstApproval("INV-1", 750_000.00m, "demo.director");
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", approver, role));

        Assert.Equal($"Role '{role}' cannot approve invoices. Only a Manager or a Director can approve.", ex.Message);
        Assert.DoesNotContain("first approval", ex.Message);
        Assert.DoesNotContain("must come from a Director", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(InvoiceStatus.PendingApproval, invoice.Status);
        Assert.Equal("demo.director", invoice.FirstApprovedBy);
        Assert.Equal(SeededFirstApprovedAt, invoice.FirstApprovedAt);
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_AdminAboveManagerLimit_GetsNoAuthorityReasonNotLimitReason()
    {
        var invoice = PendingInvoice("INV-1", 75_000.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.admin", "Admin"));

        Assert.Contains(NoAuthorityTail, ex.Message);
        Assert.DoesNotContain("50,000.00", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    // ---------------------------------------------------------------------
    // R5 with non-null prior decision data: a denial must not clear or overwrite any field
    // ---------------------------------------------------------------------

    [Fact]
    public void Approve_RoleWithoutAuthorityOnInvoiceWithPriorDecisionData_LeavesEveryFieldUnchanged()
    {
        var invoice = PendingInvoiceWithPriorDecisionData("INV-1", 100.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.admin", "Admin"));

        Assert.Equal("Role 'Admin' cannot approve invoices. Only a Manager or a Director can approve.", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_ManagerAboveLimitOnInvoiceWithPriorDecisionData_LeavesEveryFieldUnchanged()
    {
        var invoice = PendingInvoiceWithPriorDecisionData("INV-1", 75_000.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.manager", "Manager"));

        Assert.Equal("A Manager may approve invoices up to 50,000.00; invoice INV-1 is 75,000.00. A Director must approve it.", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_SameUserSecondApprovalOnInvoiceWithPriorDecisionData_LeavesEveryFieldUnchanged()
    {
        var invoice = PendingInvoiceWithPriorDecisionData("INV-1", 750_000.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.director", "Director"));

        Assert.Equal("demo.director already gave the first approval for invoice INV-1; the second approval must come from a different person.", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    [Fact]
    public void Approve_ManagerSecondApprovalOnInvoiceWithPriorDecisionData_LeavesEveryFieldUnchanged()
    {
        var invoice = PendingInvoiceWithPriorDecisionData("INV-1", 750_000.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ApprovalDeniedException>(() => service.Approve("INV-1", "demo.manager", "Manager"));

        Assert.Equal("The second approval for invoice INV-1 (above 500,000.00) must come from a Director; demo.manager is a Manager.", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    // ---------------------------------------------------------------------
    // Reject is not limited by amount or role
    // ---------------------------------------------------------------------

    [Fact]
    public void Reject_ByManagerAboveEveryLimit_Rejects()
    {
        var invoice = PendingInvoice("INV-1", 1_000_000.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);

        var result = service.Reject("INV-1", "demo.manager", "Duplicate");

        Assert.Same(invoice, result);
        Assert.Equal(InvoiceStatus.Rejected, invoice.Status);
        Assert.Equal("demo.manager", invoice.DecidedBy);
        Assert.Equal("Duplicate", invoice.DecisionNote);
        Assert.NotNull(invoice.DecidedAt);
        Assert.Equal(1, repository.UpdateCalls);
    }

    [Fact]
    public void Reject_ByAdminAboveManagerLimit_Rejects()
    {
        var invoice = PendingInvoice("INV-1", 75_000.00m);
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);

        var result = service.Reject("INV-1", "demo.admin", "Wrong customer");

        Assert.Same(invoice, result);
        Assert.Equal(InvoiceStatus.Rejected, invoice.Status);
        Assert.Equal("demo.admin", invoice.DecidedBy);
        Assert.Equal("Wrong customer", invoice.DecisionNote);
        Assert.NotNull(invoice.DecidedAt);
        Assert.Equal(1, repository.UpdateCalls);
    }

    [Fact]
    public void Reject_AfterFirstApproval_KeepsFirstApprover()
    {
        var invoice = PendingInvoiceWithFirstApproval("INV-1", 750_000.00m, "demo.manager");
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);

        var result = service.Reject("INV-1", "demo.director", "Budget exceeded");

        Assert.Same(invoice, result);
        Assert.Equal(InvoiceStatus.Rejected, invoice.Status);
        Assert.Equal("demo.director", invoice.DecidedBy);
        Assert.Equal("Budget exceeded", invoice.DecisionNote);
        Assert.NotNull(invoice.DecidedAt);
        Assert.Equal("demo.manager", invoice.FirstApprovedBy);
        Assert.Equal(SeededFirstApprovedAt, invoice.FirstApprovedAt);
        Assert.Equal(1, repository.UpdateCalls);
    }

    [Fact]
    public void Reject_ByFirstApproverAfterOwnFirstApproval_RejectsAndKeepsFirstApprover()
    {
        var invoice = PendingInvoiceWithFirstApproval("INV-1", 750_000.00m, "demo.manager");
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);

        var result = service.Reject("INV-1", "demo.manager", "Wrong amount");

        Assert.Same(invoice, result);
        Assert.Equal(InvoiceStatus.Rejected, invoice.Status);
        Assert.Equal("demo.manager", invoice.DecidedBy);
        Assert.Equal("Wrong amount", invoice.DecisionNote);
        Assert.Equal("demo.manager", invoice.FirstApprovedBy);
        Assert.Equal(SeededFirstApprovedAt, invoice.FirstApprovedAt);
        Assert.Equal(1, repository.UpdateCalls);
    }

    [Fact]
    public void Reject_WithoutReasonAfterFirstApproval_ThrowsAndLeavesEveryFieldUnchanged()
    {
        var invoice = PendingInvoiceWithFirstApproval("INV-1", 750_000.00m, "demo.manager");
        var repository = new FakeInvoiceRepository(invoice);
        var service = new ApprovalService(repository);
        var before = DecisionFields(invoice);

        var ex = Assert.Throws<ArgumentException>(() => service.Reject("INV-1", "demo.director", " "));

        Assert.Contains("reason is required", ex.Message);
        Assert.Equal(before, DecisionFields(invoice));
        Assert.Equal(0, repository.UpdateCalls);
    }

    /// <summary>Switches CurrentCulture for one test and restores it on dispose.</summary>
    private sealed class CultureScope : IDisposable
    {
        private readonly CultureInfo _previousCulture = CultureInfo.CurrentCulture;
        private readonly CultureInfo _previousUiCulture = CultureInfo.CurrentUICulture;

        public CultureScope(string name)
        {
            CultureInfo.CurrentCulture = new CultureInfo(name);
            CultureInfo.CurrentUICulture = new CultureInfo(name);
        }

        public void Dispose()
        {
            CultureInfo.CurrentCulture = _previousCulture;
            CultureInfo.CurrentUICulture = _previousUiCulture;
        }
    }
}
