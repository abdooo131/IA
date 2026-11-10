import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * Sends every order in a CSV file to Shipply and writes a results CSV with the AWBs.
 *
 * Command line:
 *   java -cp bin ShipOrders orders.csv              (writes orders_awb.csv)
 *   java -cp bin ShipOrders orders.csv results.csv
 *
 * The API key comes from SHIPPLY_API_KEY or shipply.properties (see ShipplyClient).
 */
public class ShipOrders {

	/** Sends all orders; one bad order never stops the rest. */
	public static List<ShipResult> sendAll(ShipplyClient client, List<ShippingOrder> orders,
			Consumer<ShipResult> onEach) throws InterruptedException {
		List<ShipResult> results = new ArrayList<>();
		for (ShippingOrder o : orders) {
			ShipResult r;
			try {
				r = client.createOrder(o);
			} catch (InterruptedException e) {
				throw e;
			} catch (Exception e) {
				r = ShipResult.failed(o.externalId, e.getMessage());
			}
			results.add(r);
			if (onEach != null) {
				onEach.accept(r);
			}
		}
		return results;
	}

	public static Path defaultResultsFile(Path input) {
		String name = input.getFileName().toString().replaceFirst("(?i)\\.csv$", "");
		return input.resolveSibling(name + "_awb.csv");
	}

	public static void main(String[] args) throws Exception {
		if (args.length < 1) {
			System.out.println("Usage: java -cp bin ShipOrders orders.csv [results.csv]");
			System.exit(1);
		}
		Path in = Path.of(args[0]);
		Path out = args.length > 1 ? Path.of(args[1]) : defaultResultsFile(in);

		ShipplyClient client;
		try {
			client = ShipplyClient.fromEnvironment();
			System.out.println("Connected to: " + client.checkKey());
		} catch (Exception e) {
			System.out.println("Could not connect to Shipply: " + e.getMessage());
			System.exit(2);
			return;
		}
		if (client.isTestKey()) {
			System.out.println("TEST key: orders are created in the sandbox and will NOT be shipped.");
		}

		List<ShippingOrder> orders = OrderCsv.read(in);
		System.out.println("Sending " + orders.size() + " orders...");

		List<ShipResult> results = sendAll(client, orders, r -> System.out.println(
			r.ok() ? r.externalId + " -> AWB " + r.awb + "  " + r.note()
			       : r.externalId + " -> FAILED: " + r.error));

		OrderCsv.writeResults(out, results);
		long ok = results.stream().filter(ShipResult::ok).count();
		System.out.println(ok + " of " + results.size() + " orders got an AWB. Results saved to " + out);
	}
}
