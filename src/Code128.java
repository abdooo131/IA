import java.awt.Graphics2D;
import java.awt.geom.Rectangle2D;

/** Code 128 (set B) barcode, readable by any courier scanner. No libraries needed. */
public final class Code128 {

	// Bar/space widths for symbol values 0..106 (106 = stop, 7 elements).
	private static final String[] PATTERNS = {
		"212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
		"221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
		"221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
		"212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
		"231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
		"231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
		"314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
		"112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
		"111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
		"214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
		"114131", "311141", "411131", "211412", "211214", "211232", "2331112"
	};
	private static final int START_B = 104;
	private static final int STOP = 106;
	private static final int QUIET = 10; // blank modules each side

	private Code128() {
	}

	/** Module widths (bar, space, bar, ...) for the text, including start, checksum and stop. */
	public static int[] encode(String text) {
		int[] values = new int[text.length() + 3];
		values[0] = START_B;
		int sum = START_B;
		for (int i = 0; i < text.length(); i++) {
			char c = text.charAt(i);
			if (c < 32 || c > 126) {
				throw new IllegalArgumentException("Barcode can't contain: " + c);
			}
			values[i + 1] = c - 32;
			sum += (c - 32) * (i + 1);
		}
		values[text.length() + 1] = sum % 103;
		values[text.length() + 2] = STOP;

		StringBuilder all = new StringBuilder();
		for (int v : values) {
			all.append(PATTERNS[v]);
		}
		int[] widths = new int[all.length()];
		for (int i = 0; i < widths.length; i++) {
			widths[i] = all.charAt(i) - '0';
		}
		return widths;
	}

	/** Total width in modules, quiet zones included. */
	public static int modules(String text) {
		int n = 2 * QUIET;
		for (int w : encode(text)) {
			n += w;
		}
		return n;
	}

	/** Draws the barcode filling the box (quiet zones included). */
	public static void draw(Graphics2D g, String text, double x, double y, double width, double height) {
		int[] widths = encode(text);
		double module = width / modules(text);
		double cx = x + QUIET * module;
		for (int i = 0; i < widths.length; i++) {
			double w = widths[i] * module;
			if (i % 2 == 0) {
				g.fill(new Rectangle2D.Double(cx, y, w, height));
			}
			cx += w;
		}
	}
}
