/** What came back for one order: the AWB plus useful status info, or an error. */
public class ShipResult {

	public String externalId;
	public String awb;            // order_number, e.g. EVE-000123
	public String status;         // new, in_progress, delivered...
	public String addressStatus;  // ok, needs_clarification, under_review
	public String feesTotal;      // EGP, empty if the address could not be priced
	public boolean isTest;
	public boolean alreadyExisted;
	public String error;
	public Object order;           // full order as returned by Shipply, used to print the label

	static ShipResult fromOrder(String externalId, Object order, boolean replayed) {
		ShipResult r = new ShipResult();
		r.externalId = Json.str(order, "external_id") != null ? Json.str(order, "external_id") : externalId;
		r.awb = Json.str(order, "order_number");
		r.status = Json.str(order, "status");
		r.addressStatus = Json.str(order, "address_status");
		String fees = Json.str(order, "fees", "total");
		r.feesTotal = fees == null ? "" : fees;
		r.isTest = Boolean.TRUE.equals(Json.get(order, "is_test"));
		r.alreadyExisted = replayed;
		r.order = order;
		return r;
	}

	static ShipResult failed(String externalId, String error) {
		ShipResult r = new ShipResult();
		r.externalId = externalId;
		r.error = error;
		return r;
	}

	public boolean ok() {
		return error == null && awb != null;
	}

	/** Human friendly note, e.g. warns when the address must be fixed before pickup. */
	public String note() {
		if (error != null) return error;
		StringBuilder n = new StringBuilder();
		if (alreadyExisted) n.append("Already sent before. ");
		if ("needs_clarification".equals(addressStatus)) {
			n.append("Address not recognised: fix it in the dashboard before pickup. ");
		}
		if (isTest) n.append("Sandbox order (not shipped).");
		return n.toString().trim();
	}
}
