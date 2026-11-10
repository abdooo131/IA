import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads orders from a CSV file (UTF-8, Arabic is fine) and writes the AWB results.
 *
 * Required columns: external_id, customer_name, phone, address_line
 * Optional columns: secondary_phone, governorate, city, area, address_notes, cod_amount,
 *                   package_size, pieces, description, allow_open_package, delivery_notes
 *
 * In Excel: File, Save As, "CSV UTF-8 (Comma delimited)".
 */
public final class OrderCsv {

	public static final String[] COLUMNS = {
		"external_id", "customer_name", "phone", "secondary_phone", "address_line",
		"governorate", "city", "area", "address_notes", "cod_amount", "package_size",
		"pieces", "description", "allow_open_package", "delivery_notes"
	};

	private OrderCsv() {
	}

	public static List<ShippingOrder> read(Path file) throws IOException {
		String text = Files.readString(file, StandardCharsets.UTF_8);
		if (text.startsWith("﻿")) {
			text = text.substring(1); // Excel adds a BOM
		}
		List<List<String>> rows = parse(text);
		if (rows.isEmpty()) {
			return new ArrayList<>();
		}

		Map<String, Integer> col = new HashMap<>();
		List<String> header = rows.get(0);
		for (int c = 0; c < header.size(); c++) {
			col.put(header.get(c).trim().toLowerCase(), c);
		}
		for (String required : new String[] {"external_id", "customer_name", "phone", "address_line"}) {
			if (!col.containsKey(required)) {
				throw new IOException("CSV is missing the column: " + required);
			}
		}

		List<ShippingOrder> orders = new ArrayList<>();
		for (int r = 1; r < rows.size(); r++) {
			List<String> row = rows.get(r);
			if (row.stream().allMatch(String::isBlank)) {
				continue;
			}
			ShippingOrder o = new ShippingOrder();
			o.externalId = cell(row, col, "external_id");
			o.customerName = cell(row, col, "customer_name");
			o.phone = normalisePhone(cell(row, col, "phone"));
			o.secondaryPhone = normalisePhone(cell(row, col, "secondary_phone"));
			o.addressLine = cell(row, col, "address_line");
			o.governorate = cell(row, col, "governorate");
			o.city = cell(row, col, "city");
			o.area = cell(row, col, "area");
			o.addressNotes = cell(row, col, "address_notes");
			o.packageSize = cell(row, col, "package_size");
			o.description = cell(row, col, "description");
			o.deliveryNotes = cell(row, col, "delivery_notes");

			String cod = cell(row, col, "cod_amount");
			try {
				o.codAmount = cod.isBlank() ? 0 : Double.parseDouble(cod.replace(",", ""));
			} catch (NumberFormatException e) {
				throw new IOException("Row " + (r + 1) + ": cod_amount is not a number: " + cod);
			}
			String pieces = cell(row, col, "pieces");
			try {
				o.pieces = pieces.isBlank() ? 1 : Integer.parseInt(pieces);
			} catch (NumberFormatException e) {
				throw new IOException("Row " + (r + 1) + ": pieces is not a whole number: " + pieces);
			}
			String open = cell(row, col, "allow_open_package").toLowerCase();
			if (open.equals("yes") || open.equals("true") || open.equals("1")) o.allowOpenPackage = true;
			if (open.equals("no") || open.equals("false") || open.equals("0")) o.allowOpenPackage = false;

			orders.add(o);
		}
		return orders;
	}

	public static void writeResults(Path file, List<ShipResult> results) throws IOException {
		try (BufferedWriter w = Files.newBufferedWriter(file, StandardCharsets.UTF_8)) {
			w.write('﻿'); // so Excel shows Arabic correctly
			w.write("external_id,awb,status,address_status,fees_total,note\r\n");
			for (ShipResult r : results) {
				w.write(String.join(",",
					esc(r.externalId), esc(r.awb), esc(r.status), esc(r.addressStatus),
					esc(r.feesTotal), esc(r.note())));
				w.write("\r\n");
			}
		}
	}

	/** Excel often drops the leading 0 of Egyptian mobiles (1055512345 → 01055512345). */
	static String normalisePhone(String p) {
		if (p == null) return "";
		p = p.replaceAll("[\\s()]", "");
		if (p.matches("1[0125]\\d{8}")) {
			p = "0" + p;
		}
		return p;
	}

	private static String cell(List<String> row, Map<String, Integer> col, String name) {
		Integer c = col.get(name);
		return c == null || c >= row.size() ? "" : row.get(c).trim();
	}

	private static String esc(String v) {
		if (v == null) return "";
		if (v.contains(",") || v.contains("\"") || v.contains("\n")) {
			return "\"" + v.replace("\"", "\"\"") + "\"";
		}
		return v;
	}

	/** RFC 4180 style CSV parsing: quoted fields, commas and newlines inside quotes. */
	static List<List<String>> parse(String text) {
		List<List<String>> rows = new ArrayList<>();
		List<String> row = new ArrayList<>();
		StringBuilder cur = new StringBuilder();
		boolean quoted = false;
		for (int i = 0; i < text.length(); i++) {
			char c = text.charAt(i);
			if (quoted) {
				if (c == '"') {
					if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
						cur.append('"');
						i++;
					} else {
						quoted = false;
					}
				} else {
					cur.append(c);
				}
			} else if (c == '"') {
				quoted = true;
			} else if (c == ',') {
				row.add(cur.toString());
				cur.setLength(0);
			} else if (c == '\n' || c == '\r') {
				if (c == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') {
					i++;
				}
				row.add(cur.toString());
				cur.setLength(0);
				rows.add(row);
				row = new ArrayList<>();
			} else {
				cur.append(c);
			}
		}
		if (cur.length() > 0 || !row.isEmpty()) {
			row.add(cur.toString());
			rows.add(row);
		}
		return rows;
	}
}
