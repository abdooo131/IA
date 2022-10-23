public class Consumption
{
    public CutType cutType;
    public float consumption;

    public Consumption(CutType type, float _consumption)
    {
        cutType = type;
        consumption = _consumption;
    }
    
    public static Consumption Consume(float amount)
    {
        return new Consumption(CutType.GM, amount);
    }
}

enum CutType
{
    CM, GM, PU, KG
}