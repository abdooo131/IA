/**
 * One order to send to Shipply (Eve Chantelle Merchant API).
 * Only externalId, customerName, phone and addressLine are required.
 */
public class ShippingOrder {

	public String externalId;      // your own order number, used to avoid duplicates
	public String customerName;
	public String phone;
	public String secondaryPhone;
	public String addressLine;     // street, building, floor, apartment
	public String governorate;     // optional, Arabic or English name
	public String city;            // optional
	public String area;            // optional
	public String addressNotes;    // landmarks
	public double codAmount;       // cash to collect, 0 if already paid
	public String packageSize;     // small_medium, large, x_large, xxl, light_bulky, heavy_bulky
	public int pieces = 1;
	public String description;     // what is inside
	public Boolean allowOpenPackage; // null means use account default
	public String deliveryNotes;

	/** Builds the JSON body for POST /orders. */
	public String toJson() {
		StringBuilder b = new StringBuilder("{");
		b.append("\"external_id\":").append(Json.quote(externalId));

		b.append(",\"customer\":{\"name\":").append(Json.quote(customerName))
		 .append(",\"phone\":").append(Json.quote(phone));
		if (notBlank(secondaryPhone)) {
			b.append(",\"secondary_phone\":").append(Json.quote(secondaryPhone));
		}
		b.append('}');

		b.append(",\"address\":{\"line\":").append(Json.quote(addressLine));
		if (notBlank(governorate)) b.append(",\"governorate\":").append(Json.quote(governorate));
		if (notBlank(city)) b.append(",\"city\":").append(Json.quote(city));
		if (notBlank(area)) b.append(",\"area\":").append(Json.quote(area));
		if (notBlank(addressNotes)) b.append(",\"notes\":").append(Json.quote(addressNotes));
		b.append('}');

		b.append(",\"package\":{\"size\":")
		 .append(Json.quote(notBlank(packageSize) ? packageSize : "small_medium"))
		 .append(",\"pieces\":").append(Math.max(1, pieces));
		if (notBlank(description)) b.append(",\"description\":").append(Json.quote(description));
		b.append('}');

		b.append(",\"cod_amount\":").append(codAmount);
		if (allowOpenPackage != null) b.append(",\"allow_open_package\":").append(allowOpenPackage);
		if (notBlank(deliveryNotes)) b.append(",\"delivery_notes\":").append(Json.quote(deliveryNotes));

		return b.append('}').toString();
	}

	static boolean notBlank(String v) {
		return v != null && !v.isBlank();
	}
}
