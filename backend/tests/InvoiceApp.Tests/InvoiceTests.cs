using InvoiceApp.Domain;
using Xunit;

namespace InvoiceApp.Tests;

public class InvoiceTests
{
    [Fact]
    public void NewInvoice_HasEmptyIdAndCustomerName_AndDraftStatus()
    {
        var invoice = new Invoice();

        Assert.Equal(string.Empty, invoice.Id);
        Assert.Equal(string.Empty, invoice.CustomerName);
        Assert.Equal(InvoiceStatus.Draft, invoice.Status);
        Assert.Null(invoice.DecidedBy);
        Assert.Null(invoice.DecidedAt);
        Assert.Null(invoice.DecisionNote);
        Assert.Null(invoice.FirstApprovedBy);
        Assert.Null(invoice.FirstApprovedAt);
    }
}
