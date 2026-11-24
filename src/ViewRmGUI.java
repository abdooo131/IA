import java.awt.Dimension;
import java.awt.EventQueue;

import javax.swing.JFrame;
import javax.swing.JPanel;
import javax.swing.JTable;
import javax.swing.JScrollPane;
import javax.swing.JLabel;
import java.awt.Font;
import javax.swing.JSeparator;

public class ViewRmGUI extends JFrame {

	private JPanel contentPane;
	private JTable table;

	/**
	 * Launch the application.
	 */
	public static void main(String[] args) {
		EventQueue.invokeLater(new Runnable() {
			public void run() {
				try {
					ViewRmGUI frame = new ViewRmGUI();
					frame.setVisible(true);
				} catch (Exception e) {
					e.printStackTrace();
				}
			}
		});
	}

	/**
	 * Create the frame.
	 */
	public ViewRmGUI() {
		setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
		Branding.applyFrame(this, "Raw Materials");
		setResizable(false);
		contentPane = new JPanel();
		contentPane.setBackground(Branding.WHITE);
		contentPane.setPreferredSize(new Dimension(450, 340));

		setContentPane(contentPane);
		contentPane.setLayout(null);
		
		JPanel panel = new JPanel();
		panel.setBackground(Branding.WHITE);
		panel.setBounds(0, 70, 450, 270);
		contentPane.add(panel);
		panel.setLayout(null);
		
		contentPane.add(Branding.header("View and Edit Raw Material", 450, 70));
		
		JScrollPane scrollPane = new JScrollPane();
		scrollPane.setBackground(Branding.WHITE);
		scrollPane.setBorder(javax.swing.BorderFactory.createLineBorder(Branding.NAVY));
		scrollPane.setBounds(18, 46, 414, 208);
		panel.add(scrollPane);
		
		table = new JTable();
		table.setFont(Branding.labelFont());
		table.setRowHeight(24);
		table.setSelectionBackground(Branding.YELLOW_LIGHT);
		table.setSelectionForeground(Branding.NAVY);
		table.getTableHeader().setBackground(Branding.NAVY);
		table.getTableHeader().setForeground(Branding.YELLOW);
		table.getTableHeader().setFont(Branding.font(Font.BOLD, 13));
		scrollPane.getViewport().setBackground(Branding.WHITE);
		scrollPane.setViewportView(table);
		
		JLabel lblViewRm = new JLabel("Raw Materials");
		lblViewRm.setFont(Branding.font(Font.BOLD, 15));
		lblViewRm.setForeground(Branding.NAVY);
		lblViewRm.setBounds(18, 6, 300, 24);
		panel.add(lblViewRm);
		
		JSeparator separator = new JSeparator();
		separator.setBounds(18, 34, 414, 3);
		panel.add(separator);
		
		pack();
		setLocationRelativeTo(null);
	}
}
