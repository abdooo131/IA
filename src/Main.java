import java.util.ArrayList;
import java.util.Arrays;

public class Main {
	public static void main(String[] args)
	{
		Style dantel = new Style(new ArrayList<RawMaterials>(
			Arrays.asList(
			new RawMaterials(400, "Cotton",
                CutType.KG, new Consumption(CutType.GM, 40)),
            new RawMaterials(500, "Elastic",
                CutType.KG, new Consumption(CutType.GM, 6)),
            new RawMaterials(200, "Dantel",
                CutType.KG, new Consumption(CutType.GM, 20)),
            new RawMaterials(5, "Packaging",
                CutType.PU, new Consumption(CutType.PU, 1)))), 101);

		float sum = 0;
        for (var mat : dantel.rawMaterialsList)
        {
            System.out.println(mat.name + " " + mat.Price());
            sum += mat.Price();
        }
        
        System.out.println("Sum of Dantel Materials " + sum);
	}
}