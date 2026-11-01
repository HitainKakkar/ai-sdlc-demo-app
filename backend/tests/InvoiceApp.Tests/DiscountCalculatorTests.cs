using InvoiceApp.Domain;
using Xunit;

namespace InvoiceApp.Tests;

/// <summary>
/// Outside the approval-limits feature: added during mutation testing (decision D-42)
/// because DiscountCalculator had no tests.
/// </summary>
public class DiscountCalculatorTests
{
    private readonly DiscountCalculator _calculator = new();

    // Both sides of every tier boundary (10, 50, 100) plus a value well inside the top tier.
    public static TheoryData<int, decimal> QuantityTiers => new()
    {
        { 0, 0m },
        { 9, 0m },
        { 10, 0.05m },
        { 49, 0.05m },
        { 50, 0.10m },
        { 99, 0.10m },
        { 100, 0.15m },
        { 101, 0.15m },
    };

    [Theory, MemberData(nameof(QuantityTiers))]
    public void QuantityDiscount_AtTierBoundaries_ReturnsTierRate(int quantity, decimal expected)
    {
        var discount = _calculator.QuantityDiscount(quantity);

        Assert.Equal(expected, discount);
    }

    public static TheoryData<int, decimal> LoyaltyYears => new()
    {
        { 0, 0m },
        { 3, 0.03m },
        { 10, 0.10m },
        { 15, 0.10m },
    };

    [Theory, MemberData(nameof(LoyaltyYears))]
    public void LoyaltyDiscount_ByYears_ReturnsOnePercentPerYearCappedAtTen(int years, decimal expected)
    {
        var discount = _calculator.LoyaltyDiscount(years);

        Assert.Equal(expected, discount);
    }

    [Fact]
    public void CombinedDiscount_RegularCustomer_AddsQuantityAndLoyalty()
    {
        var discount = _calculator.CombinedDiscount(50, 3, "Retail");

        Assert.Equal(0.13m, discount);
    }

    [Fact]
    public void CombinedDiscount_NullCustomerType_AddsQuantityAndLoyaltyOnly()
    {
        var discount = _calculator.CombinedDiscount(50, 3, null);

        Assert.Equal(0.13m, discount);
    }

    [Fact]
    public void CombinedDiscount_EmptyCustomerType_AddsQuantityAndLoyaltyOnly()
    {
        var discount = _calculator.CombinedDiscount(50, 3, "");

        Assert.Equal(0.13m, discount);
    }

    [Fact]
    public void CombinedDiscount_Nonprofit_AddsFivePercentBonus()
    {
        var discount = _calculator.CombinedDiscount(50, 3, "Nonprofit");

        Assert.Equal(0.18m, discount);
    }

    [Fact]
    public void ApplyDiscount_FifteenPercentOnThousand_ReturnsEightHundredFifty()
    {
        var result = _calculator.ApplyDiscount(1_000.00m, 0.15m);

        Assert.Equal(850.00m, result);
    }

    [Fact]
    public void ApplyDiscount_ResultWithMoreThanTwoDecimals_RoundsToTwoDecimals()
    {
        var result = _calculator.ApplyDiscount(99.99m, 0.15m);

        Assert.Equal(84.99m, result);
    }

    // Math.Round(decimal, 2) uses MidpointRounding.ToEven (banker's rounding).
    public static TheoryData<decimal, decimal> MidpointAmounts => new()
    {
        { 10.005m, 10.00m },
        { 10.015m, 10.02m },
    };

    [Theory, MemberData(nameof(MidpointAmounts))]
    public void ApplyDiscount_MidpointAmountAtZeroRate_RoundsToEven(decimal amount, decimal expected)
    {
        var result = _calculator.ApplyDiscount(amount, 0m);

        Assert.Equal(expected, result);
    }
}
