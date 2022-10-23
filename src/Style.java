import java.util.ArrayList;
import java.util.List;

public class Style
{
    public List<RawMaterials> rawMaterialsList;
    public int code;

    public Style(ArrayList<RawMaterials> materialsUsed , int _code)
    {
        rawMaterialsList = materialsUsed;
        code = _code;
    }
}
