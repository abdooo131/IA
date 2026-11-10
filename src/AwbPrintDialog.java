import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.Window;
import java.awt.print.PageFormat;
import java.awt.print.Paper;
import java.awt.print.Printable;
import java.awt.print.PrinterException;
import java.awt.print.PrinterJob;
import java.util.List;

import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;

/**
 * Shows the AWB labels and prints them.
 * Choose "Microsoft Print to PDF" in the printer list to save a PDF instead.
 */
public class AwbPrintDialog extends JDialog {

	private static final long serialVersionUID = 1L;
	private static final double MM = 72 / 25.4;

	public enum Layout {
		LABEL_10X15("Label sticker 10 x 15 cm (one per page)", 100 * MM, 150 * MM, 1, 1),
		A4_4UP("A4 paper, 4 labels per page", 210 * MM, 297 * MM, 2, 2),
		A4_1UP("A4 paper, 1 label per page", 210 * MM, 297 * MM, 1, 1);

		final String title;
		final double pageW;
		final double pageH;
		final int cols;
		final int rows;

		Layout(String title, double pageW, double pageH, int cols, int rows) {
			this.title = title;
			this.pageW = pageW;
			this.pageH = pageH;
			this.cols = cols;
			this.rows = rows;
		}

		int perPage() {
			return cols * rows;
		}

		@Override
		public String toString() {
			return title;
		}
	}

	private final List<AwbLabel> labels;
	private final JComboBox<Layout> cmbLayout = new JComboBox<>(Layout.values());
	private final Preview preview = new Preview();

	public static void show(Window owner, List<AwbLabel> labels) {
		if (labels.isEmpty()) {
			JOptionPane.showMessageDialog(owner, "There are no orders with an AWB to print.");
			return;
		}
		new AwbPrintDialog(owner, labels).setVisible(true);
	}

	public AwbPrintDialog(Window owner, List<AwbLabel> labels) {
		super(owner, "Print AWBs (" + labels.size() + ")", ModalityType.APPLICATION_MODAL);
		this.labels = labels;
		setSize(760, 760);
		setLocationRelativeTo(owner);

		JButton btnPrint = new JButton("Print...");
		JButton btnClose = new JButton("Close");
		JPanel top = new JPanel(new FlowLayout(FlowLayout.LEFT));
		top.add(new JLabel("Paper:"));
		top.add(cmbLayout);
		top.add(btnPrint);
		top.add(btnClose);

		getContentPane().setLayout(new BorderLayout());
		getContentPane().add(top, BorderLayout.NORTH);
		JScrollPane sp = new JScrollPane(preview);
		sp.getVerticalScrollBar().setUnitIncrement(24);
		getContentPane().add(sp, BorderLayout.CENTER);
		JLabel tip = new JLabel("  Tip: to save as PDF, choose \"Microsoft Print to PDF\" as the printer.");
		tip.setForeground(Color.DARK_GRAY);
		getContentPane().add(tip, BorderLayout.SOUTH);

		cmbLayout.addActionListener(e -> {
			preview.revalidate();
			preview.repaint();
		});
		btnPrint.addActionListener(e -> print());
		btnClose.addActionListener(e -> dispose());
	}

	private Layout paperLayout() {
		return (Layout) cmbLayout.getSelectedItem();
	}

	/** Paints page number `page` (0 based) into a page of the given size. */
	private void paintPage(Graphics2D g, int page, Layout lay, double x, double y, double w, double h) {
		double cellW = w / lay.cols;
		double cellH = h / lay.rows;
		double gap = lay.perPage() > 1 ? 6 * MM : 0;
		for (int i = 0; i < lay.perPage(); i++) {
			int index = page * lay.perPage() + i;
			if (index >= labels.size()) {
				return;
			}
			int col = i % lay.cols;
			int row = i / lay.cols;
			labels.get(index).paint(g, x + col * cellW + gap / 2, y + row * cellH + gap / 2,
				cellW - gap, cellH - gap);
		}
	}

	private int pages(Layout lay) {
		return (labels.size() + lay.perPage() - 1) / lay.perPage();
	}

	private void print() {
		Layout lay = paperLayout();
		PrinterJob job = PrinterJob.getPrinterJob();
		job.setJobName("Shipply AWBs");

		Paper paper = new Paper();
		paper.setSize(lay.pageW, lay.pageH);
		double margin = lay == Layout.LABEL_10X15 ? 2 * MM : 8 * MM;
		paper.setImageableArea(margin, margin, lay.pageW - 2 * margin, lay.pageH - 2 * margin);
		PageFormat pf = job.defaultPage();
		pf.setPaper(paper);
		pf.setOrientation(PageFormat.PORTRAIT);

		job.setPrintable(new Printable() {
			@Override
			public int print(Graphics g, PageFormat f, int page) {
				if (page >= pages(lay)) {
					return NO_SUCH_PAGE;
				}
				paintPage((Graphics2D) g, page, lay, f.getImageableX(), f.getImageableY(),
					f.getImageableWidth(), f.getImageableHeight());
				return PAGE_EXISTS;
			}
		}, pf);

		if (job.printDialog()) {
			try {
				job.print();
			} catch (PrinterException ex) {
				JOptionPane.showMessageDialog(this, ex.getMessage(), "Printing failed", JOptionPane.ERROR_MESSAGE);
			}
		}
	}

	/** On screen preview of every page. */
	private class Preview extends JPanel {
		private static final long serialVersionUID = 1L;
		private static final int PAD = 16;

		Preview() {
			setBackground(new Color(120, 120, 120));
		}

		private double scale() {
			Layout lay = paperLayout();
			return Math.min(1.6, 640 / lay.pageW);
		}

		@Override
		public Dimension getPreferredSize() {
			Layout lay = paperLayout();
			double s = scale();
			return new Dimension((int) (lay.pageW * s) + 2 * PAD,
				(int) (pages(lay) * (lay.pageH * s + PAD)) + PAD);
		}

		@Override
		protected void paintComponent(Graphics g0) {
			super.paintComponent(g0);
			Graphics2D g = (Graphics2D) g0;
			Layout lay = paperLayout();
			double s = scale();
			double pw = lay.pageW * s;
			double ph = lay.pageH * s;
			double x = Math.max(PAD, (getWidth() - pw) / 2);
			for (int p = 0; p < pages(lay); p++) {
				double y = PAD + p * (ph + PAD);
				g.setColor(Color.WHITE);
				g.fillRect((int) x, (int) y, (int) pw, (int) ph);
				double margin = (lay == Layout.LABEL_10X15 ? 2 : 8) * MM * s;
				paintPage(g, p, lay, x + margin, y + margin, pw - 2 * margin, ph - 2 * margin);
			}
		}
	}
}
