import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Tiny JSON helper so the project needs no external libraries.
 * parse() returns Map, List, String, Double, Boolean or null.
 */
public final class Json {

	private final String s;
	private int i;

	private Json(String s) {
		this.s = s;
	}

	public static Object parse(String text) {
		Json p = new Json(text);
		p.ws();
		Object v = p.value();
		p.ws();
		if (p.i != p.s.length()) {
			throw new IllegalArgumentException("Unexpected data at position " + p.i);
		}
		return v;
	}

	/** Quote a Java string as a JSON string literal. */
	public static String quote(String v) {
		if (v == null) {
			return "null";
		}
		StringBuilder b = new StringBuilder("\"");
		for (char c : v.toCharArray()) {
			switch (c) {
				case '"': b.append("\\\""); break;
				case '\\': b.append("\\\\"); break;
				case '\n': b.append("\\n"); break;
				case '\r': b.append("\\r"); break;
				case '\t': b.append("\\t"); break;
				default:
					if (c < 0x20) {
						b.append(String.format("\\u%04x", (int) c));
					} else {
						b.append(c);
					}
			}
		}
		return b.append('"').toString();
	}

	/** Walk a parsed tree by keys, e.g. get(root, "data", "order_number"). */
	@SuppressWarnings("unchecked")
	public static Object get(Object node, String... path) {
		for (String key : path) {
			if (!(node instanceof Map)) {
				return null;
			}
			node = ((Map<String, Object>) node).get(key);
		}
		return node;
	}

	public static String str(Object node, String... path) {
		Object v = get(node, path);
		if (v == null) {
			return null;
		}
		if (v instanceof Double) {
			double d = (Double) v;
			if (d == Math.rint(d)) {
				return String.valueOf((long) d);
			}
		}
		return String.valueOf(v);
	}

	private Object value() {
		if (i >= s.length()) {
			throw new IllegalArgumentException("Unexpected end of JSON");
		}
		char c = s.charAt(i);
		if (c == '{') return object();
		if (c == '[') return array();
		if (c == '"') return string();
		if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
		if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
		if (s.startsWith("null", i)) { i += 4; return null; }
		return number();
	}

	private Map<String, Object> object() {
		Map<String, Object> m = new LinkedHashMap<>();
		i++;
		ws();
		if (peek() == '}') { i++; return m; }
		while (true) {
			ws();
			String k = string();
			ws();
			expect(':');
			ws();
			m.put(k, value());
			ws();
			if (peek() == ',') { i++; continue; }
			expect('}');
			return m;
		}
	}

	private List<Object> array() {
		List<Object> l = new ArrayList<>();
		i++;
		ws();
		if (peek() == ']') { i++; return l; }
		while (true) {
			ws();
			l.add(value());
			ws();
			if (peek() == ',') { i++; continue; }
			expect(']');
			return l;
		}
	}

	private String string() {
		expect('"');
		StringBuilder b = new StringBuilder();
		while (true) {
			char c = s.charAt(i++);
			if (c == '"') return b.toString();
			if (c != '\\') { b.append(c); continue; }
			char e = s.charAt(i++);
			switch (e) {
				case 'n': b.append('\n'); break;
				case 't': b.append('\t'); break;
				case 'r': b.append('\r'); break;
				case 'b': b.append('\b'); break;
				case 'f': b.append('\f'); break;
				case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
				default: b.append(e);
			}
		}
	}

	private Double number() {
		int start = i;
		while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) {
			i++;
		}
		if (start == i) {
			throw new IllegalArgumentException("Unexpected character at position " + i);
		}
		return Double.valueOf(s.substring(start, i));
	}

	private char peek() {
		return i < s.length() ? s.charAt(i) : '\0';
	}

	private void expect(char c) {
		if (peek() != c) {
			throw new IllegalArgumentException("Expected '" + c + "' at position " + i);
		}
		i++;
	}

	private void ws() {
		while (i < s.length() && Character.isWhitespace(s.charAt(i))) {
			i++;
		}
	}
}
