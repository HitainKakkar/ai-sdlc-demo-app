using InvoiceApp.Domain;
using Xunit;

namespace InvoiceApp.Tests;

public class ApprovalLimitsTests
{
    [Fact]
    public void ManagerLimit_IsFiftyThousand()
    {
        Assert.Equal(50_000.00m, ApprovalLimits.ManagerLimit);
    }

    [Fact]
    public void DirectorLimit_IsFiveHundredThousand()
    {
        Assert.Equal(500_000.00m, ApprovalLimits.DirectorLimit);
    }

    [Fact]
    public void TwoApproverThreshold_IsFiveHundredThousand()
    {
        Assert.Equal(500_000.00m, ApprovalLimits.TwoApproverThreshold);
    }

    [Fact]
    public void RoleNames_AreManagerAndDirector()
    {
        Assert.Equal("Manager", ApprovalLimits.ManagerRole);
        Assert.Equal("Director", ApprovalLimits.DirectorRole);
    }

    [Fact]
    public void LimitFor_Manager_ReturnsFiftyThousand()
    {
        var limit = ApprovalLimits.LimitFor("Manager");

        Assert.Equal(50_000.00m, limit);
    }

    [Fact]
    public void LimitFor_Director_ReturnsFiveHundredThousand()
    {
        var limit = ApprovalLimits.LimitFor("Director");

        Assert.Equal(500_000.00m, limit);
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("Approver")]
    [InlineData("manager")]
    [InlineData("director")]
    [InlineData(" Manager")]
    [InlineData("Director ")]
    [InlineData("   ")]
    [InlineData("")]
    [InlineData(null)]
    public void LimitFor_RoleWithoutApprovalAuthority_ReturnsNull(string? role)
    {
        var limit = ApprovalLimits.LimitFor(role);

        Assert.Null(limit);
    }
}
