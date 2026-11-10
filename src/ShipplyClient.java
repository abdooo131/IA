import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.Properties;

/**
 * Client for the Shipply / Eve Chantelle Merchant API v1.
 * Docs: https://shipply.site/docs/api
 *
 * The AWB (tracking number) is the "order_number" returned when an order is created, e.g. EVE-000123.
 *
 * API key lookup order:
 *   1. environment variable SHIPPLY_API_KEY
 *   2. file shipply.properties in the working folder, line: api.key=ec_test_...
 * Never commit the key: shipply.properties is listed in .gitignore.
 */
public class ShipplyClient {

	public static final String BASE_URL = "https://shipply.site/api/v1";
	private static final int MAX_ATTEMPTS = 4;

	private final String apiKey;
	private final String baseUrl;
	private final HttpClient http = HttpClient.newBuilder()
			.connectTimeout(Duration.ofSeconds(15))
			.build();

	public ShipplyClient(String apiKey) {
		this(apiKey, System.getProperty("shipply.baseUrl", BASE_URL)); // override only for testing
	}

	public ShipplyClient(String apiKey, String baseUrl) {
		if (apiKey == null || apiKey.isBlank()) {
			throw new IllegalArgumentException(
				"No API key. Set SHIPPLY_API_KEY or put api.key=... in shipply.properties");
		}
		this.apiKey = apiKey.trim();
		this.baseUrl = baseUrl;
	}

	/** Creates a client using SHIPPLY_API_KEY or shipply.properties. */
	public static ShipplyClient fromEnvironment() throws IOException {
		String key = System.getenv("SHIPPLY_API_KEY");
		if (key == null || key.isBlank()) {
			key = loadSavedKey();
		}
		return new ShipplyClient(key);
	}

	public static final Path KEY_FILE = Path.of("shipply.properties");

	/** The key saved in shipply.properties, or null. */
	public static String loadSavedKey() throws IOException {
		if (!Files.exists(KEY_FILE)) {
			return null;
		}
		Properties p = new Properties();
		try (InputStream in = Files.newInputStream(KEY_FILE)) {
			p.load(in);
		}
		return p.getProperty("api.key");
	}

	/** Saves the key to shipply.properties (this file is in .gitignore). */
	public static void saveKey(String key) throws IOException {
		Properties p = new Properties();
		p.setProperty("api.key", key.trim());
		try (java.io.OutputStream out = Files.newOutputStream(KEY_FILE)) {
			p.store(out, "Shipply API key. Never commit or share this file.");
		}
	}

	/** One governorate or city: our id plus a display name. */
	public static class Place {
		public final String id;
		public final String name;

		Place(String id, String name) {
			this.id = id;
			this.name = name;
		}

		@Override
		public String toString() {
			return name;
		}
	}

	/** GET /governorates */
	public java.util.List<Place> listGovernorates() throws IOException, InterruptedException {
		return places(send("GET", "/governorates", null).json);
	}

	/** GET /governorates/{id}/cities */
	public java.util.List<Place> listCities(String governorateId) throws IOException, InterruptedException {
		return places(send("GET", "/governorates/" + encode(governorateId) + "/cities", null).json);
	}

	private static java.util.List<Place> places(Object root) {
		java.util.List<Place> list = new java.util.ArrayList<>();
		Object data = Json.get(root, "data");
		if (data instanceof java.util.List) {
			for (Object item : (java.util.List<?>) data) {
				String ar = Json.str(item, "name_ar");
				String en = Json.str(item, "name_en");
				String name = en == null || en.isBlank() ? ar : en + "    " + ar;
				list.add(new Place(Json.str(item, "id"), name));
			}
		}
		return list;
	}

	public boolean isTestKey() {
		return apiKey.startsWith("ec_test_");
	}

	/** GET /me: confirms the key works. Returns e.g. "Nova Home Store (test)". */
	public String checkKey() throws IOException, InterruptedException {
		Object root = send("GET", "/me", null).json;
		String name = Json.str(root, "data", "merchant", "business_name_en");
		if (name == null) name = Json.str(root, "data", "merchant", "business_name_ar");
		return name + " (" + Json.str(root, "data", "api_key", "environment") + ")";
	}

	/**
	 * POST /orders. Returns the result with the AWB.
	 * Safe to call again for the same order: the API returns the existing order instead of a duplicate.
	 */
	public ShipResult createOrder(ShippingOrder order) throws IOException, InterruptedException {
		Response r = send("POST", "/orders", order.toJson());
		return ShipResult.fromOrder(order.externalId, Json.get(r.json, "data"), r.replayed);
	}

	/** GET /orders/{order}: look up by your external id or by the AWB (order number). */
	public ShipResult getOrder(String externalIdOrAwb) throws IOException, InterruptedException {
		Response r = send("GET", "/orders/" + encode(externalIdOrAwb), null);
		return ShipResult.fromOrder(externalIdOrAwb, Json.get(r.json, "data"), false);
	}

	/** POST /orders/{order}/cancel: only works before pickup (status "new"). */
	public ShipResult cancelOrder(String externalIdOrAwb, String reason) throws IOException, InterruptedException {
		String body = reason == null ? "{}" : "{\"reason\":" + Json.quote(reason) + "}";
		Response r = send("POST", "/orders/" + encode(externalIdOrAwb) + "/cancel", body);
		return ShipResult.fromOrder(externalIdOrAwb, Json.get(r.json, "data"), false);
	}

	// ------------------------------------------------------------------

	private static class Response {
		Object json;
		boolean replayed;
	}

	private Response send(String method, String path, String body) throws IOException, InterruptedException {
		for (int attempt = 1; ; attempt++) {
			HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(baseUrl + path))
					.timeout(Duration.ofSeconds(30))
					.header("Authorization", "Bearer " + apiKey)
					.header("Accept", "application/json");
			if (body != null) {
				req.header("Content-Type", "application/json")
				   .method(method, HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
			} else {
				req.method(method, HttpRequest.BodyPublishers.noBody());
			}

			HttpResponse<String> res;
			try {
				res = http.send(req.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
			} catch (IOException networkError) {
				// Creating is idempotent on external_id, so retrying is safe.
				if (attempt >= MAX_ATTEMPTS) throw networkError;
				Thread.sleep(2000L * attempt);
				continue;
			}

			int code = res.statusCode();
			if (code == 429 && attempt < MAX_ATTEMPTS) {
				long wait = res.headers().firstValue("Retry-After").map(Long::parseLong).orElse(10L);
				Thread.sleep(Math.max(1, wait) * 1000L);
				continue;
			}
			if (code >= 500 && attempt < MAX_ATTEMPTS) {
				Thread.sleep(2000L * attempt);
				continue;
			}

			Object json = res.body().isBlank() ? null : Json.parse(res.body());
			if (code >= 300) {
				throw ShipplyException.from(code, json);
			}
			Response r = new Response();
			r.json = json;
			r.replayed = "true".equalsIgnoreCase(res.headers().firstValue("Idempotent-Replayed").orElse(""));
			return r;
		}
	}

	private static String encode(String v) {
		return URLEncoder.encode(v, StandardCharsets.UTF_8).replace("+", "%20");
	}

	/** Error returned by the API, with its stable code (e.g. validation_failed). */
	public static class ShipplyException extends IOException {
		private static final long serialVersionUID = 1L;
		public final int httpStatus;
		public final String code;

		ShipplyException(int httpStatus, String code, String message) {
			super(message);
			this.httpStatus = httpStatus;
			this.code = code;
		}

		@SuppressWarnings("unchecked")
		static ShipplyException from(int status, Object json) {
			String code = Json.str(json, "error", "code");
			StringBuilder msg = new StringBuilder();
			msg.append(code != null ? code : "http_" + status).append(": ");
			String m = Json.str(json, "error", "message");
			msg.append(m != null ? m : "HTTP " + status);
			Object fields = Json.get(json, "error", "fields");
			if (fields instanceof Map) {
				for (Map.Entry<String, Object> e : ((Map<String, Object>) fields).entrySet()) {
					msg.append(" | ").append(e.getKey()).append(": ").append(e.getValue());
				}
			}
			return new ShipplyException(status, code, msg.toString());
		}
	}
}
