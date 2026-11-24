import java.awt.Color;
import java.awt.Cursor;
import java.awt.Font;
import java.awt.GraphicsEnvironment;
import java.awt.Image;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import javax.swing.BorderFactory;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.SwingConstants;
import javax.swing.border.Border;

/**
 * Career Gate brand colors, fonts and logo assets, shared by every window.
 * Images live in src/images and are loaded from the classpath.
 */
public final class Branding {

	public static final String NAME = "Career Gate";
	public static final String TAGLINE = "Real Job Opportunities in Egypt";

	/** Signature yellow, #FEC401. */
	public static final Color YELLOW = new Color(0xFE, 0xC4, 0x01);
	/** Soft yellow used for cards and pills, #FFF3C4. */
	public static final Color YELLOW_LIGHT = new Color(0xFF, 0xF3, 0xC4);
	/** Deep navy used for the logo and text, #141F2D. */
	public static final Color NAVY = new Color(0x14, 0x1F, 0x2D);
	/** Slightly lighter navy for hover states, #24344A. */
	public static final Color NAVY_LIGHT = new Color(0x24, 0x34, 0x4A);
	public static final Color WHITE = Color.WHITE;

	private static final String FONT_FAMILY = pickFontFamily("Segoe UI", "Montserrat", "Poppins", "Arial");

	private Branding() {
	}

	public static Font font(int style, float size) {
		return new Font(FONT_FAMILY, style, Math.round(size));
	}

	public static Font titleFont() {
		return font(Font.BOLD, 22);
	}

	public static Font labelFont() {
		return font(Font.PLAIN, 14);
	}

	/** Loads an image from src/images, or returns null when it is missing. */
	public static ImageIcon image(String fileName) {
		URL url = Branding.class.getResource("/images/" + fileName);
		return url == null ? null : new ImageIcon(url);
	}

	/** Loads an image from src/images scaled to the given width, keeping its aspect ratio. */
	public static ImageIcon image(String fileName, int width) {
		ImageIcon icon = image(fileName);
		if (icon == null || icon.getIconWidth() <= 0) {
			return icon;
		}
		int height = Math.round(icon.getIconHeight() * (width / (float) icon.getIconWidth()));
		return new ImageIcon(icon.getImage().getScaledInstance(width, height, Image.SCALE_SMOOTH));
	}

	/** Career Gate logo (on its yellow background) scaled to the given width. */
	public static JLabel logo(int width) {
		ImageIcon icon = image("logo.png", width);
		JLabel label = icon != null ? new JLabel(icon) : new JLabel(NAME);
		if (icon == null) {
			label.setFont(titleFont());
			label.setForeground(NAVY);
		}
		label.setHorizontalAlignment(SwingConstants.CENTER);
		return label;
	}

	/** Sets the window title prefix and the door icon in the title bar and taskbar. */
	public static void applyFrame(JFrame frame, String title) {
		frame.setTitle(title == null || title.isEmpty() ? NAME : NAME + " | " + title);
		List<Image> icons = new ArrayList<>();
		for (int size : new int[] { 16, 32, 64, 128, 256 }) {
			ImageIcon icon = image("icon-" + size + ".png");
			if (icon != null) {
				icons.add(icon.getImage());
			}
		}
		if (!icons.isEmpty()) {
			frame.setIconImages(icons);
		}
	}

	/** Yellow header band with the logo on the left and a navy title on the right. */
	public static JPanel header(String title, int width, int height) {
		JPanel header = new JPanel(null);
		header.setBackground(YELLOW);
		header.setBounds(0, 0, width, height);

		int logoWidth = Math.round((height - 12) * 600f / 304f);
		JLabel logo = logo(logoWidth);
		logo.setBounds(12, 6, logoWidth, height - 12);
		header.add(logo);

		JLabel lblTitle = new JLabel(title);
		lblTitle.setFont(font(Font.BOLD, 18));
		lblTitle.setForeground(NAVY);
		lblTitle.setHorizontalAlignment(SwingConstants.RIGHT);
		lblTitle.setBounds(logoWidth + 24, 0, width - logoWidth - 40, height);
		header.add(lblTitle);
		return header;
	}

	/** Navy button with yellow text, for the main action on a screen. */
	public static void primaryButton(JButton button) {
		styleButton(button, NAVY, YELLOW, NAVY_LIGHT);
	}

	/** Yellow button with navy text, for secondary actions. */
	public static void secondaryButton(JButton button) {
		styleButton(button, YELLOW, NAVY, YELLOW_LIGHT);
	}

	/** Light outlined button for cancel or exit actions. */
	public static void outlineButton(JButton button) {
		styleButton(button, WHITE, NAVY, YELLOW_LIGHT);
		button.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(NAVY, 1),
				BorderFactory.createEmptyBorder(4, 12, 4, 12)));
	}

	private static void styleButton(JButton button, Color bg, Color fg, Color hover) {
		button.setBackground(bg);
		button.setForeground(fg);
		button.setFont(font(Font.BOLD, 13));
		button.setFocusPainted(false);
		button.setContentAreaFilled(true);
		button.setOpaque(true);
		button.setBorderPainted(true);
		button.setBorder(BorderFactory.createEmptyBorder(4, 12, 4, 12));
		button.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
		button.getModel().addChangeListener(e -> button.setBackground(button.getModel().isRollover() ? hover : bg));
	}

	/** Navy label text in the brand font. */
	public static void label(JLabel label) {
		label.setFont(labelFont());
		label.setForeground(NAVY);
	}

	/** Thin navy underline border for text inputs. */
	public static void input(JComponent field) {
		Border line = BorderFactory.createMatteBorder(0, 0, 2, 0, NAVY);
		field.setBorder(BorderFactory.createCompoundBorder(line, BorderFactory.createEmptyBorder(2, 6, 2, 6)));
		field.setFont(labelFont());
		field.setForeground(NAVY);
		field.setBackground(WHITE);
	}

	private static String pickFontFamily(String... preferred) {
		try {
			List<String> available = Arrays.asList(
					GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames());
			for (String name : preferred) {
				if (available.contains(name)) {
					return name;
				}
			}
		} catch (Exception e) {
			// headless or no font info, fall through
		}
		return Font.SANS_SERIF;
	}
}
