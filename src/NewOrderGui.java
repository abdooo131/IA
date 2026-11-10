import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.EventQueue;
import java.awt.FlowLayout;
import java.awt.Font;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.Toolkit;
import java.awt.datatransfer.StringSelection;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

import javax.swing.BorderFactory;
import javax.swing.DefaultComboBoxModel;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JScrollPane;
import javax.swing.JSpinner;
import javax.swing.JSplitPane;
import javax.swing.JTable;
import javax.swing.JTextField;
import javax.swing.SpinnerNumberModel;
import javax.swing.SwingWorker;
import javax.swing.table.DefaultTableModel;

/**
 * Page to enter the Shipply API key and create orders one by one.
 * Each created order shows its AWB (Shipply order number).
 */
public class NewOrderGui extends JFrame {

	private static final long serialVersionUID = 1L;
	private static final String PICK = "(choose)";

	// API key
	private final JPasswordField txtKey = new JPasswordField(38);
	private final JCheckBox chkShow = new JCheckBox("Show");
	private final JButton btnConnect = new JButton("Save & Connect");
	private final JLabel lblConnection = new JLabel("Not connected");

	// Order form
	private final JTextField txtOrderNo = new JTextField(14);
	private final JTextField txtName = new JTextField(14);
	private final JTextField txtPhone = new JTextField(14);
	private final JTextField txtPhone2 = new JTextField(14);
	private final JTextField txtAddress = new JTextField(14);
	private final JComboBox<Object> cmbGov = new JComboBox<>();
	private final JComboBox<Object> cmbCity = new JComboBox<>();
	private final JTextField txtArea = new JTextField(14);
	private final JTextField txtLandmark = new JTextField(14);
	private final JTextField txtCod = new JTextField("0", 14);
	private final JComboBox<String> cmbSize = new JComboBox<>(
		new String[] {"small_medium", "large", "x_large", "xxl", "light_bulky", "heavy_bulky"});
	private final JSpinner spnPieces = new JSpinner(new SpinnerNumberModel(1, 1, 100, 1));
	private final JTextField txtDescription = new JTextField(14);
	private final JCheckBox chkOpen = new JCheckBox("Customer may open the package");
	private final JTextField txtNotes = new JTextField(14);
	private final JButton btnCreate = new JButton("Create order");
	private final JButton btnClear = new JButton("Clear");

	// Result
	private final JLabel lblAwb = new JLabel(" ");
	private final JLabel lblResultNote = new JLabel(" ");
	private final JButton btnCopy = new JButton("Copy AWB");
	private final DefaultTableModel history = new DefaultTableModel(
		new Object[] {"Order", "AWB", "Customer", "Phone", "COD", "Fees", "Note"}, 0) {
		private static final long serialVersionUID = 1L;
		@Override
		public boolean isCellEditable(int row, int column) {
			return column == 1; // select and copy the AWB
		}
	};

	private ShipplyClient client;

	public static void main(String[] args) {
		EventQueue.invokeLater(() -> new NewOrderGui().setVisible(true));
	}

	public NewOrderGui() {
		setTitle("New Shipply Order");
		setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
		setSize(1000, 680);
		setLocationRelativeTo(null);

		getContentPane().setLayout(new BorderLayout(8, 8));
		getContentPane().add(keyPanel(), BorderLayout.NORTH);

		JSplitPane split = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT,
			new JScrollPane(formPanel()), resultPanel());
		split.setResizeWeight(0.45);
		split.setDividerLocation(470);
		getContentPane().add(split, BorderLayout.CENTER);

		resetPlaces();
		setFormEnabled(false);
		newOrderNumber();
		wireEvents();
		loadSavedKey();
	}

	// ------------------------------------------------------------------ layout

	private JPanel keyPanel() {
		JPanel row = new JPanel(new FlowLayout(FlowLayout.LEFT));
		row.add(txtKey);
		row.add(chkShow);
		row.add(btnConnect);
		JPanel p = new JPanel(new BorderLayout());
		p.setBorder(BorderFactory.createTitledBorder("Shipply API key"));
		p.add(row, BorderLayout.NORTH);
		lblConnection.setBorder(BorderFactory.createEmptyBorder(0, 8, 4, 8));
		lblConnection.setFont(lblConnection.getFont().deriveFont(Font.BOLD));
		p.add(lblConnection, BorderLayout.SOUTH);
		return p;
	}

	private JPanel formPanel() {
		JPanel p = new JPanel(new GridBagLayout());
		p.setBorder(BorderFactory.createTitledBorder("Order"));
		int r = 0;
		r = row(p, r, "Order number *", txtOrderNo);
		r = row(p, r, "Customer name *", txtName);
		r = row(p, r, "Phone *", txtPhone);
		r = row(p, r, "Second phone", txtPhone2);
		r = row(p, r, "Address *", txtAddress);
		r = row(p, r, "Governorate", cmbGov);
		r = row(p, r, "City", cmbCity);
		r = row(p, r, "Area", txtArea);
		r = row(p, r, "Landmark", txtLandmark);
		r = row(p, r, "Cash to collect (EGP)", txtCod);
		r = row(p, r, "Package size", cmbSize);
		r = row(p, r, "Pieces", spnPieces);
		r = row(p, r, "What's inside", txtDescription);
		r = row(p, r, "", chkOpen);
		r = row(p, r, "Notes for courier", txtNotes);

		JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
		btnCreate.setFont(btnCreate.getFont().deriveFont(Font.BOLD));
		buttons.add(btnCreate);
		buttons.add(new JLabel("  "));
		buttons.add(btnClear);
		row(p, r, "", buttons);

		JLabel hint = new JLabel("<html>* required. The address can be one line,<br>Shipply finds the area from it.</html>");
		hint.setForeground(Color.GRAY);
		row(p, r + 1, "", hint);
		return p;
	}

	private JPanel resultPanel() {
		JPanel p = new JPanel(new BorderLayout(4, 4));

		JPanel last = new JPanel(new BorderLayout(4, 4));
		last.setBorder(BorderFactory.createTitledBorder("AWB"));
		lblAwb.setFont(new Font("SansSerif", Font.BOLD, 28));
		JPanel awbRow = new JPanel(new FlowLayout(FlowLayout.LEFT));
		awbRow.add(lblAwb);
		awbRow.add(btnCopy);
		btnCopy.setEnabled(false);
		last.add(awbRow, BorderLayout.NORTH);
		last.add(lblResultNote, BorderLayout.CENTER);
		p.add(last, BorderLayout.NORTH);

		JTable table = new JTable(history);
		JScrollPane sp = new JScrollPane(table);
		sp.setBorder(BorderFactory.createTitledBorder("Orders created in this window"));
		sp.setPreferredSize(new Dimension(500, 300));
		p.add(sp, BorderLayout.CENTER);
		return p;
	}

	private static int row(JPanel p, int r, String label, JComponent field) {
		GridBagConstraints c = new GridBagConstraints();
		c.insets = new Insets(3, 6, 3, 6);
		c.gridy = r;
		c.gridx = 0;
		c.anchor = GridBagConstraints.LINE_END;
		p.add(new JLabel(label), c);
		c.gridx = 1;
		c.fill = GridBagConstraints.HORIZONTAL;
		c.weightx = 1;
		c.anchor = GridBagConstraints.LINE_START;
		p.add(field, c);
		return r + 1;
	}

	// ------------------------------------------------------------------ behaviour

	private void wireEvents() {
		char echo = txtKey.getEchoChar();
		chkShow.addActionListener(e -> txtKey.setEchoChar(chkShow.isSelected() ? (char) 0 : echo));
		btnConnect.addActionListener(e -> connect(true));
		txtKey.addActionListener(e -> connect(true));
		cmbGov.addActionListener(e -> loadCities());
		btnCreate.addActionListener(e -> createOrder());
		btnClear.addActionListener(e -> clearForm());
		btnCopy.addActionListener(e -> Toolkit.getDefaultToolkit().getSystemClipboard()
			.setContents(new StringSelection(lblAwb.getText()), null));
	}

	private void loadSavedKey() {
		try {
			String key = ShipplyClient.loadSavedKey();
			if (key != null && !key.isBlank()) {
				txtKey.setText(key);
				connect(false);
			}
		} catch (Exception ex) {
			lblConnection.setText("Could not read saved key: " + ex.getMessage());
		}
	}

	private void connect(boolean save) {
		String key = new String(txtKey.getPassword()).trim();
		if (!key.startsWith("ec_test_") && !key.startsWith("ec_live_")) {
			showError("Invalid key", "A Shipply key starts with ec_test_ or ec_live_.\n"
				+ "Create one in the dashboard: Integrations, REST API.");
			return;
		}
		btnConnect.setEnabled(false);
		lblConnection.setForeground(Color.DARK_GRAY);
		lblConnection.setText("Connecting...");

		new SwingWorker<List<ShipplyClient.Place>, Void>() {
			private ShipplyClient c;
			private String account;

			@Override
			protected List<ShipplyClient.Place> doInBackground() throws Exception {
				c = new ShipplyClient(key);
				account = c.checkKey();
				if (save) {
					ShipplyClient.saveKey(key);
				}
				return c.listGovernorates();
			}

			@Override
			protected void done() {
				btnConnect.setEnabled(true);
				try {
					List<ShipplyClient.Place> govs = get();
					client = c;
					boolean test = c.isTestKey();
					lblConnection.setForeground(test ? new Color(180, 110, 0) : new Color(0, 130, 0));
					lblConnection.setText("Connected: " + account
						+ (test ? "   TEST mode, orders are NOT shipped" : "   LIVE, real shipments"));
					fillGovernorates(govs);
					setFormEnabled(true);
				} catch (Exception ex) {
					client = null;
					setFormEnabled(false);
					lblConnection.setForeground(Color.RED);
					lblConnection.setText("Not connected");
					showError("Could not connect", rootMessage(ex));
				}
			}
		}.execute();
	}

	private void resetPlaces() {
		cmbGov.setModel(new DefaultComboBoxModel<>(new Object[] {PICK}));
		cmbCity.setModel(new DefaultComboBoxModel<>(new Object[] {PICK}));
	}

	private void fillGovernorates(List<ShipplyClient.Place> govs) {
		DefaultComboBoxModel<Object> m = new DefaultComboBoxModel<>();
		m.addElement(PICK);
		for (ShipplyClient.Place g : govs) {
			m.addElement(g);
		}
		cmbGov.setModel(m);
		cmbCity.setModel(new DefaultComboBoxModel<>(new Object[] {PICK}));
	}

	private void loadCities() {
		Object sel = cmbGov.getSelectedItem();
		cmbCity.setModel(new DefaultComboBoxModel<>(new Object[] {PICK}));
		if (client == null || !(sel instanceof ShipplyClient.Place)) {
			return;
		}
		String govId = ((ShipplyClient.Place) sel).id;
		ShipplyClient c = client;
		new SwingWorker<List<ShipplyClient.Place>, Void>() {
			@Override
			protected List<ShipplyClient.Place> doInBackground() throws Exception {
				return c.listCities(govId);
			}

			@Override
			protected void done() {
				try {
					if (cmbGov.getSelectedItem() != sel) {
						return; // user picked another governorate meanwhile
					}
					DefaultComboBoxModel<Object> m = new DefaultComboBoxModel<>();
					m.addElement(PICK);
					for (ShipplyClient.Place p : get()) {
						m.addElement(p);
					}
					cmbCity.setModel(m);
				} catch (Exception ex) {
					showError("Could not load cities", rootMessage(ex));
				}
			}
		}.execute();
	}

	private void createOrder() {
		if (client == null) {
			showError("Not connected", "Enter your API key and click Save & Connect first.");
			return;
		}
		ShippingOrder o;
		try {
			o = readForm();
		} catch (IllegalArgumentException ex) {
			showError("Please check the form", ex.getMessage());
			return;
		}

		btnCreate.setEnabled(false);
		lblResultNote.setText("Sending...");
		ShipplyClient c = client;
		new SwingWorker<ShipResult, Void>() {
			@Override
			protected ShipResult doInBackground() throws Exception {
				return c.createOrder(o);
			}

			@Override
			protected void done() {
				btnCreate.setEnabled(true);
				try {
					ShipResult r = get();
					lblAwb.setText(r.awb);
					btnCopy.setEnabled(true);
					String note = r.note();
					if (!r.feesTotal.isEmpty()) {
						note = "Shipping fees: " + r.feesTotal + " EGP. " + note;
					}
					lblResultNote.setForeground(
						"needs_clarification".equals(r.addressStatus) ? Color.RED : Color.DARK_GRAY);
					lblResultNote.setText("<html>" + escapeHtml(note) + "</html>");
					history.insertRow(0, new Object[] {
						r.externalId, r.awb, o.customerName, o.phone, o.codAmount, r.feesTotal, r.note()});
					if (!r.alreadyExisted) {
						clearForm();
					}
				} catch (Exception ex) {
					lblResultNote.setForeground(Color.RED);
					lblResultNote.setText("Order not created.");
					showError("Order not created", rootMessage(ex));
				}
			}
		}.execute();
	}

	private ShippingOrder readForm() {
		ShippingOrder o = new ShippingOrder();
		o.externalId = required(txtOrderNo, "Order number");
		o.customerName = required(txtName, "Customer name");
		o.phone = OrderCsv.normalisePhone(required(txtPhone, "Phone"));
		if (!o.phone.matches("01[0125]\\d{8}")) {
			throw new IllegalArgumentException("Phone must be an Egyptian mobile like 01012345678.");
		}
		o.secondaryPhone = OrderCsv.normalisePhone(txtPhone2.getText().trim());
		o.addressLine = required(txtAddress, "Address");

		Object gov = cmbGov.getSelectedItem();
		Object city = cmbCity.getSelectedItem();
		if (gov instanceof ShipplyClient.Place) {
			o.governorateId = ((ShipplyClient.Place) gov).id;
			if (city instanceof ShipplyClient.Place) {
				o.cityId = ((ShipplyClient.Place) city).id;
			}
		}
		o.area = txtArea.getText().trim();
		o.addressNotes = txtLandmark.getText().trim();

		String cod = txtCod.getText().trim().replace(",", "");
		try {
			o.codAmount = cod.isEmpty() ? 0 : Double.parseDouble(cod);
		} catch (NumberFormatException e) {
			throw new IllegalArgumentException("Cash to collect must be a number, e.g. 450.");
		}
		if (o.codAmount < 0) {
			throw new IllegalArgumentException("Cash to collect can't be negative.");
		}
		o.packageSize = (String) cmbSize.getSelectedItem();
		o.pieces = (Integer) spnPieces.getValue();
		o.description = txtDescription.getText().trim();
		o.allowOpenPackage = chkOpen.isSelected();
		o.deliveryNotes = txtNotes.getText().trim();
		return o;
	}

	private void clearForm() {
		for (JTextField f : new JTextField[] {txtName, txtPhone, txtPhone2, txtAddress, txtArea,
				txtLandmark, txtDescription, txtNotes}) {
			f.setText("");
		}
		txtCod.setText("0");
		spnPieces.setValue(1);
		cmbSize.setSelectedIndex(0);
		cmbGov.setSelectedIndex(0);
		chkOpen.setSelected(false);
		newOrderNumber();
		txtName.requestFocusInWindow();
	}

	/** Suggests a unique order number; you can type your own instead. */
	private void newOrderNumber() {
		txtOrderNo.setText("EC" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyMMddHHmmss")));
	}

	private void setFormEnabled(boolean on) {
		for (JComponent f : new JComponent[] {txtOrderNo, txtName, txtPhone, txtPhone2, txtAddress,
				cmbGov, cmbCity, txtArea, txtLandmark, txtCod, cmbSize, spnPieces, txtDescription,
				chkOpen, txtNotes, btnCreate, btnClear}) {
			f.setEnabled(on);
		}
	}

	private static String required(JTextField f, String name) {
		String v = f.getText().trim();
		if (v.isEmpty()) {
			throw new IllegalArgumentException(name + " is required.");
		}
		return v;
	}

	private static String rootMessage(Exception ex) {
		Throwable t = ex;
		while (t.getCause() != null) {
			t = t.getCause();
		}
		return t.getMessage() != null ? t.getMessage() : t.toString();
	}

	private static String escapeHtml(String s) {
		return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
	}

	private void showError(String title, String msg) {
		JOptionPane.showMessageDialog(this, msg, title, JOptionPane.ERROR_MESSAGE);
	}
}
