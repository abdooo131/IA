import java.awt.BorderLayout;
import java.awt.EventQueue;
import java.awt.FlowLayout;
import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import javax.swing.JButton;
import javax.swing.JFileChooser;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTable;
import javax.swing.SwingUtilities;
import javax.swing.SwingWorker;
import javax.swing.filechooser.FileNameExtensionFilter;
import javax.swing.table.DefaultTableModel;

/** Window: pick an orders CSV, send it to Shipply, see the AWBs, save them. */
public class ShipOrdersGui extends JFrame {

	private static final long serialVersionUID = 1L;

	private final DefaultTableModel model = new DefaultTableModel(
		new Object[] {"Order", "AWB", "Status", "Address", "Fees (EGP)", "Note"}, 0) {
		private static final long serialVersionUID = 1L;
		@Override
		public boolean isCellEditable(int row, int column) {
			return column == 1; // lets you select and copy the AWB
		}
	};
	private final JLabel status = new JLabel("Choose a CSV file with your orders.");
	private final JButton btnOpen = new JButton("Choose orders CSV...");
	private final JButton btnSend = new JButton("Send to Shipply");
	private final JButton btnSave = new JButton("Save AWBs...");
	private final JButton btnPrint = new JButton("Print AWBs...");
	private String sender = "";

	private Path csvFile;
	private List<ShippingOrder> orders = new ArrayList<>();
	private List<ShipResult> results = new ArrayList<>();

	public static void main(String[] args) {
		EventQueue.invokeLater(() -> new ShipOrdersGui().setVisible(true));
	}

	public ShipOrdersGui() {
		setTitle("Send Orders to Shipply");
		setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
		setSize(900, 450);
		setLocationRelativeTo(null);

		JPanel top = new JPanel(new FlowLayout(FlowLayout.LEFT));
		top.add(btnOpen);
		top.add(btnSend);
		top.add(btnSave);
		top.add(btnPrint);
		btnPrint.setEnabled(false);
		btnSend.setEnabled(false);
		btnSave.setEnabled(false);

		JTable table = new JTable(model);
		table.setAutoCreateRowSorter(true);

		getContentPane().setLayout(new BorderLayout());
		getContentPane().add(top, BorderLayout.NORTH);
		getContentPane().add(new JScrollPane(table), BorderLayout.CENTER);
		getContentPane().add(status, BorderLayout.SOUTH);

		btnOpen.addActionListener(e -> chooseCsv());
		btnSend.addActionListener(e -> send());
		btnSave.addActionListener(e -> save());
		btnPrint.addActionListener(e -> {
			List<AwbLabel> labels = new ArrayList<>();
			for (ShipResult r : results) {
				if (r.ok() && r.order != null) {
					labels.add(AwbLabel.fromOrder(r.order, sender));
				}
			}
			AwbPrintDialog.show(this, labels);
		});
	}

	private void chooseCsv() {
		JFileChooser fc = new JFileChooser();
		fc.setFileFilter(new FileNameExtensionFilter("CSV files", "csv"));
		if (fc.showOpenDialog(this) != JFileChooser.APPROVE_OPTION) {
			return;
		}
		try {
			csvFile = fc.getSelectedFile().toPath();
			orders = OrderCsv.read(csvFile);
			results.clear();
			model.setRowCount(0);
			for (ShippingOrder o : orders) {
				model.addRow(new Object[] {o.externalId, "", "", "", "", "Ready"});
			}
			status.setText(orders.size() + " orders loaded from " + csvFile.getFileName());
			btnSend.setEnabled(!orders.isEmpty());
			btnSave.setEnabled(false);
			btnPrint.setEnabled(false);
		} catch (Exception ex) {
			error("Could not read the CSV", ex);
		}
	}

	private void send() {
		ShipplyClient client;
		String account;
		try {
			client = ShipplyClient.fromEnvironment();
			account = client.checkKey();
			sender = account.replaceAll("\\s*\\((test|live)\\)$", "");
		} catch (Exception ex) {
			error("Could not connect to Shipply", ex);
			return;
		}

		String env = client.isTestKey() ? "TEST (sandbox, nothing will be shipped)" : "LIVE (real shipments)";
		int ok = JOptionPane.showConfirmDialog(this,
			"Send " + orders.size() + " orders to " + account + "?\nEnvironment: " + env,
			"Confirm", JOptionPane.OK_CANCEL_OPTION);
		if (ok != JOptionPane.OK_OPTION) {
			return;
		}

		btnOpen.setEnabled(false);
		btnSend.setEnabled(false);
		results = new ArrayList<>();

		new SwingWorker<Void, ShipResult>() {
			@Override
			protected Void doInBackground() throws Exception {
				ShipOrders.sendAll(client, orders, this::publish);
				return null;
			}

			@Override
			protected void process(List<ShipResult> chunk) {
				for (ShipResult r : chunk) {
					int row = results.size();
					results.add(r);
					model.setValueAt(r.awb == null ? "" : r.awb, row, 1);
					model.setValueAt(r.status == null ? "" : r.status, row, 2);
					model.setValueAt(r.addressStatus == null ? "" : r.addressStatus, row, 3);
					model.setValueAt(r.feesTotal == null ? "" : r.feesTotal, row, 4);
					model.setValueAt(r.ok() ? r.note() : "FAILED: " + r.error, row, 5);
					status.setText("Sent " + results.size() + " of " + orders.size() + "...");
				}
			}

			@Override
			protected void done() {
				btnOpen.setEnabled(true);
				btnSend.setEnabled(true); // resending is safe, existing orders are not duplicated
				btnSave.setEnabled(!results.isEmpty());
				btnPrint.setEnabled(results.stream().anyMatch(ShipResult::ok));
				long good = results.stream().filter(ShipResult::ok).count();
				status.setText(good + " of " + orders.size() + " orders got an AWB.");
				try {
					get();
				} catch (Exception ex) {
					error("Sending stopped", ex);
				}
			}
		}.execute();
	}

	private void save() {
		JFileChooser fc = new JFileChooser();
		fc.setSelectedFile(new File(ShipOrders.defaultResultsFile(csvFile).toString()));
		if (fc.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) {
			return;
		}
		try {
			OrderCsv.writeResults(fc.getSelectedFile().toPath(), results);
			status.setText("Saved to " + fc.getSelectedFile().getName());
		} catch (Exception ex) {
			error("Could not save", ex);
		}
	}

	private void error(String title, Exception ex) {
		SwingUtilities.invokeLater(() ->
			JOptionPane.showMessageDialog(this, ex.getMessage(), title, JOptionPane.ERROR_MESSAGE));
	}
}
