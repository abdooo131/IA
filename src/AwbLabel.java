import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.font.FontRenderContext;
import java.awt.font.LineBreakMeasurer;
import java.awt.font.TextAttribute;
import java.awt.font.TextLayout;
import java.awt.geom.AffineTransform;
import java.awt.geom.Line2D;
import java.awt.geom.Rectangle2D;
import java.text.AttributedString;
import java.text.DecimalFormat;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

/**
 * One printable AWB label, built from the order exactly as Shipply returned it.
 * Designed at 4 x 6 inch (288 x 432 points) and scaled to whatever box it is printed in.
 */
public class AwbLabel {

	public static final double WIDTH = 288;
	public static final double HEIGHT = 432;
	private static final String FONT = "Dialog"; // logical font: has Arabic glyphs on Windows

	public String sender = "";
	public String awb = "";
	public String orderNo = "";
	public String customer = "";
	public String phones = "";
	public String addressLine = "";
	public String place = "";      // area, city, governorate
	public String landmark = "";
	public double cod;
	public String type = "deliver";
	public String packageInfo = "";
	public String description = "";
	public boolean openAllowed;
	public String notes = "";
	public boolean test;
	public String date = LocalDate.now().format(DateTimeFormatter.ofPattern("dd/MM/yyyy"));

	/** Builds a label from the "data" object of a Shipply order. */
	public static AwbLabel fromOrder(Object o, String sender) {
		AwbLabel l = new AwbLabel();
		l.sender = nz(sender);
		l.awb = nz(Json.str(o, "order_number"));
		l.orderNo = nz(Json.str(o, "reference"));
		if (l.orderNo.isEmpty()) l.orderNo = nz(Json.str(o, "external_id"));
		l.customer = nz(Json.str(o, "customer", "name"));
		l.phones = join("  /  ", Json.str(o, "customer", "phone"), Json.str(o, "customer", "secondary_phone"));
		l.addressLine = nz(Json.str(o, "address", "line"));
		l.place = join("، ", Json.str(o, "address", "area"), Json.str(o, "address", "city"),
			Json.str(o, "address", "governorate"));
		l.landmark = nz(Json.str(o, "address", "notes"));
		String cod = Json.str(o, "cod_amount");
		l.cod = cod == null ? 0 : Double.parseDouble(cod);
		l.type = nz(Json.str(o, "type"));
		String size = Json.str(o, "package", "size");
		String pieces = Json.str(o, "package", "pieces");
		if (size != null) {
			l.packageInfo = (pieces == null ? "1" : pieces) + " pc, " + size.replace('_', ' ');
		}
		l.description = nz(Json.str(o, "package", "description"));
		l.openAllowed = Boolean.TRUE.equals(Json.get(o, "allow_open_package"));
		l.notes = nz(Json.str(o, "delivery_notes"));
		l.test = Boolean.TRUE.equals(Json.get(o, "is_test"));
		return l;
	}

	/** Paints the label into the box (x, y, w, h), keeping its proportions. */
	public void paint(Graphics2D g0, double x, double y, double w, double h) {
		Graphics2D g = (Graphics2D) g0.create();
		g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
		g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
		double s = Math.min(w / WIDTH, h / HEIGHT);
		g.translate(x + (w - WIDTH * s) / 2, y + (h - HEIGHT * s) / 2);
		g.scale(s, s);

		g.setColor(Color.WHITE);
		g.fill(new Rectangle2D.Double(0, 0, WIDTH, HEIGHT));
		g.setColor(Color.BLACK);
		g.setStroke(new BasicStroke(1.2f));
		double m = 10;              // margin
		double inner = WIDTH - 2 * m;
		g.draw(new Rectangle2D.Double(m / 2, m / 2, WIDTH - m, HEIGHT - m));

		// Header: sender and date
		double yy = m + 2;
		yy = text(g, sender.isEmpty() ? "Sender" : sender, m, yy, inner * 0.65, bold(13), false);
		text(g, date, m + inner * 0.65, m + 2, inner * 0.35, plain(9), true);
		text(g, "Shipply", m + inner * 0.65, m + 14, inner * 0.35, plain(8), true);
		yy = rule(g, Math.max(yy, m + 24) + 2);

		// Barcode
		double barH = 62;
		Code128.draw(g, awb, m, yy + 4, inner, barH);
		yy += barH + 6;
		yy = centered(g, awb, yy, bold(18)) + 2;
		yy = rule(g, yy);

		// Customer
		yy = text(g, "TO", m, yy + 3, inner, plain(7), false);
		yy = text(g, customer, m, yy, inner, bold(14), false);
		yy = text(g, phones, m, yy + 1, inner, bold(12), false);
		yy = text(g, addressLine, m, yy + 3, inner, plain(10.5f), false);
		if (!place.isEmpty()) yy = text(g, place, m, yy + 1, inner, bold(10.5f), false);
		if (!landmark.isEmpty()) yy = text(g, landmark, m, yy + 1, inner, plain(9), false);
		yy = rule(g, yy + 4);

		// Cash box
		double boxH = 38;
		g.setStroke(new BasicStroke(2f));
		g.draw(new Rectangle2D.Double(m, yy + 4, inner, boxH));
		String cash = cod > 0
			? "COLLECT  " + new DecimalFormat("#,##0.##").format(cod) + " EGP"
			: "PAID, collect nothing";
		centered(g, cash, yy + 4 + (boxH - 20) / 2, bold(cod > 0 ? 18 : 14));
		yy += boxH + 8;
		g.setStroke(new BasicStroke(1.2f));

		// Details
		double colW = inner / 2;
		double dy = yy + 2;
		text(g, "Order: " + orderNo, m, dy, colW, plain(9), false);
		text(g, packageInfo, m + colW, dy, colW, plain(9), false);
		dy += 13;
		text(g, openAllowed ? "Customer may open: YES" : "Customer may open: NO", m, dy, colW, bold(9), false);
		if (!"deliver".equals(type) && !type.isEmpty()) {
			text(g, "Type: " + type.replace('_', ' ').toUpperCase(), m + colW, dy, colW, bold(9), false);
		}
		dy += 14;
		if (!description.isEmpty()) dy = text(g, "Contents: " + description, m, dy, inner, plain(9), false);
		if (!notes.isEmpty()) dy = text(g, "Notes: " + notes, m, dy + 1, inner, plain(9), false);

		// Test watermark
		if (test) {
			Graphics2D t = (Graphics2D) g.create();
			t.setColor(new Color(220, 0, 0, 90));
			t.setFont(bold(34));
			t.rotate(-Math.PI / 5, WIDTH / 2, HEIGHT / 2);
			FontRenderContext frc = t.getFontRenderContext();
			String wm = "TEST, NOT SHIPPED";
			double tw = t.getFont().getStringBounds(wm, frc).getWidth();
			t.drawString(wm, (float) (WIDTH / 2 - tw / 2), (float) (HEIGHT / 2));
			t.dispose();
		}
		g.dispose();
	}

	// ------------------------------------------------------------------ helpers

	private static Font bold(float size) {
		return new Font(FONT, Font.BOLD, 1).deriveFont(size);
	}

	private static Font plain(float size) {
		return new Font(FONT, Font.PLAIN, 1).deriveFont(size);
	}

	private static double rule(Graphics2D g, double y) {
		g.draw(new Line2D.Double(10, y, WIDTH - 10, y));
		return y + 2;
	}

	private static double centered(Graphics2D g, String s, double y, Font f) {
		if (s.isEmpty()) return y;
		TextLayout tl = new TextLayout(s, f, g.getFontRenderContext());
		tl.draw(g, (float) ((WIDTH - tl.getAdvance()) / 2), (float) (y + tl.getAscent()));
		return y + tl.getAscent() + tl.getDescent();
	}

	/**
	 * Draws wrapped text at most 3 lines; Arabic lines are right aligned.
	 * Returns the y below the text.
	 */
	private static double text(Graphics2D g, String s, double x, double y, double width, Font f, boolean alignRight) {
		if (s == null || s.isEmpty()) return y;
		AttributedString as = new AttributedString(s);
		as.addAttribute(TextAttribute.FONT, f);
		FontRenderContext frc = new FontRenderContext(new AffineTransform(), true, true);
		LineBreakMeasurer lbm = new LineBreakMeasurer(as.getIterator(), frc);
		int lines = 0;
		while (lbm.getPosition() < s.length() && lines < 3) {
			TextLayout tl = lbm.nextLayout((float) width);
			y += tl.getAscent();
			boolean right = alignRight || !tl.isLeftToRight();
			double dx = right ? x + width - tl.getAdvance() : x;
			tl.draw(g, (float) dx, (float) y);
			y += tl.getDescent() + tl.getLeading();
			lines++;
		}
		return y;
	}

	private static String nz(String v) {
		return v == null ? "" : v.trim();
	}

	private static String join(String sep, String... parts) {
		StringBuilder b = new StringBuilder();
		for (String p : parts) {
			if (p != null && !p.isBlank()) {
				if (b.length() > 0) b.append(sep);
				b.append(p.trim());
			}
		}
		return b.toString();
	}
}
