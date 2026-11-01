using InvoiceApp.Domain;
using Xunit;

namespace InvoiceApp.Tests;

public class ApprovalDeniedExceptionTests
{
    [Fact]
    public void ApprovalDeniedException_DerivesFromInvalidOperationException()
    {
        var isInvalidOperation = typeof(InvalidOperationException).IsAssignableFrom(typeof(ApprovalDeniedException));

        Assert.True(isInvalidOperation);
    }

    [Fact]
    public void Constructor_GivenMessage_PreservesMessage()
    {
        var exception = new ApprovalDeniedException("A Manager may approve invoices up to 50,000.00.");

        Assert.Equal("A Manager may approve invoices up to 50,000.00.", exception.Message);
    }
}
