public class RawMaterials
{
    public float pricePerUnit;
    public String name;
    public CutType cutType;
    public int code;
    public Consumption consumption;
    
    public RawMaterials(float _price, String _name, CutType type, Consumption _consumption, int _code)
    {
        pricePerUnit = _price;
        name = _name;
        cutType = type;
        consumption = _consumption;
        code = _code;
    }
    
    public RawMaterials(float _price, String _name, CutType type, Consumption _consumption)
    {
        pricePerUnit = _price;
        name = _name;
        cutType = type;
        consumption = _consumption;
    }

    public float Price()
    {
        float consum = 0;

        switch (cutType)
        {
            case KG:
                switch (consumption.cutType)
                {
                    case GM:
                        consum = pricePerUnit / 1000 * consumption.consumption;
                        return consum;
                    case KG:
                        consum = pricePerUnit * consumption.consumption;
                        return consum;
                    case PU:
                        return 0;
                    case CM:
                        return 0;
                }
                break;
            case GM:
                switch (consumption.cutType)
                {
                    case GM:
                        consum = pricePerUnit * consumption.consumption;
                        return consum;
                    case KG:
                        consum = pricePerUnit * 1000 * consumption.consumption;
                        return consum;
                    case PU:
                        return 0;
                    case CM:
                        return 0;
                }
                break;
            case CM:
                if (consumption.cutType == CutType.CM)
                {
                    consum = pricePerUnit * consumption.consumption;
                    return consum;
                }
                else
                {
                	return 0;
                }
            case PU:
                if (consumption.cutType == CutType.PU)
                {
                    consum = pricePerUnit * consumption.consumption;
                    return consum;
                }
                else
                {
                	return 0;
                }
        }

        return 0f;
    }
}


