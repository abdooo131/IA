import java.awt.Dimension;
import java.awt.EventQueue;
import java.awt.Font;

import javax.swing.JFrame;
import javax.swing.JPanel;
import javax.swing.JMenuBar;
import javax.swing.JMenuItem;
import javax.swing.JMenu;
import javax.swing.Box;
import javax.swing.JButton;
import javax.swing.JSeparator;
import javax.swing.SwingConstants;
import javax.swing.JSpinner;
import javax.swing.JLabel;
import java.awt.Component;
import javax.swing.JTextField;
import javax.swing.JTable;
import javax.swing.JProgressBar;
import javax.swing.JRadioButton;

public class MainApp extends JFrame {

	private JPanel contentPane;
	private JTextField textField;

	/**
	 * Launch the application.
	 */
	public static void main(String[] args) {
		EventQueue.invokeLater(new Runnable() {
			public void run() {
				try {
					MainApp frame = new MainApp();
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
	public MainApp() {
		setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
		Branding.applyFrame(this, "Home");
		setResizable(false);
		
		JMenuBar menuBar = new JMenuBar();
		menuBar.setBackground(Branding.NAVY);
		menuBar.setOpaque(true);
		menuBar.setBorderPainted(false);
		setJMenuBar(menuBar);
		
		JMenu mnFiles = new JMenu("File");
		styleMenu(mnFiles);
		menuBar.add(mnFiles);
		
		JMenuItem mntmNewMenuItem_1 = new JMenuItem("Manage users ");
		mnFiles.add(mntmNewMenuItem_1);
		
		JSeparator separator = new JSeparator();
		mnFiles.add(separator);
		
		JMenu mnNewMenu_1 = new JMenu("Style");
		styleMenu(mnNewMenu_1);
		menuBar.add(mnNewMenu_1);
		
		JMenuItem mntmAddStyle = new JMenuItem("Add New");
		mnNewMenu_1.add(mntmAddStyle);
		
		JSeparator separator_1 = new JSeparator();
		mnNewMenu_1.add(separator_1);
		
		JMenuItem mntmStyleVandA = new JMenuItem("View and Edit");
		mnNewMenu_1.add(mntmStyleVandA);
		
		JMenu mnRM = new JMenu("Raw Material");
		styleMenu(mnRM);
		menuBar.add(mnRM);
		
		JMenuItem mntmRmAddNew = new JMenuItem("Add New");
		mnRM.add(mntmRmAddNew);
		
		JSeparator separator_2 = new JSeparator();
		mnRM.add(separator_2);
		
		JMenuItem mntmRmVandA = new JMenuItem("View and Edit");
		mnRM.add(mntmRmVandA);
		
		JMenu mnNewMenu = new JMenu("Find");
		styleMenu(mnNewMenu);
		menuBar.add(mnNewMenu);
		
		textField = new JTextField();
		mnNewMenu.add(textField);
		textField.setColumns(10);
		
		menuBar.add(Box.createHorizontalGlue());
		
		JButton btnRefresh = new JButton("Refresh");
		Branding.secondaryButton(btnRefresh);
		menuBar.add(btnRefresh);
		
		JButton btnLogOut = new JButton("Log Out");
		Branding.outlineButton(btnLogOut);
		menuBar.add(btnLogOut);
		contentPane = new JPanel();
		contentPane.setBackground(Branding.NAVY);
		contentPane.setPreferredSize(new Dimension(600, 330));

		setContentPane(contentPane);
		contentPane.setLayout(null);
		
		JLabel lblNewLabel = new JLabel(Branding.image("banner.png", 600));
		lblNewLabel.setAlignmentX(Component.CENTER_ALIGNMENT);
		lblNewLabel.setBounds(0, 0, 600, 200);
		contentPane.add(lblNewLabel);
		
		JLabel lblWelcome = new JLabel("Welcome to " + Branding.NAME);
		lblWelcome.setFont(Branding.titleFont());
		lblWelcome.setForeground(Branding.YELLOW);
		lblWelcome.setHorizontalAlignment(SwingConstants.CENTER);
		lblWelcome.setBounds(0, 222, 600, 32);
		contentPane.add(lblWelcome);
		
		JLabel lblTagline = new JLabel("Connecting you with the right opportunity to grow your career");
		lblTagline.setFont(Branding.font(Font.PLAIN, 14));
		lblTagline.setForeground(Branding.WHITE);
		lblTagline.setHorizontalAlignment(SwingConstants.CENTER);
		lblTagline.setBounds(0, 258, 600, 22);
		contentPane.add(lblTagline);
		
		pack();
		setLocationRelativeTo(null);
	}
	
	private static void styleMenu(JMenu menu) {
		menu.setForeground(Branding.WHITE);
		menu.setFont(Branding.font(Font.BOLD, 13));
	}
}
