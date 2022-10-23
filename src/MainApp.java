import java.awt.EventQueue;

import javax.swing.JFrame;
import javax.swing.JPanel;
import javax.swing.border.EmptyBorder;
import javax.swing.JMenuBar;
import javax.swing.JMenuItem;
import javax.swing.JMenu;
import javax.swing.JButton;
import javax.swing.JSeparator;
import javax.swing.SwingConstants;
import javax.swing.JSpinner;
import javax.swing.JLabel;
import javax.swing.ImageIcon;
import java.awt.Component;
import javax.swing.JTextField;
import javax.swing.JTable;
import javax.swing.JProgressBar;
import java.awt.Color;
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
		setBounds(100, 100, 600, 448);
		
		JMenuBar menuBar = new JMenuBar();
		setJMenuBar(menuBar);
		
		JMenu mnFiles = new JMenu("File");
		menuBar.add(mnFiles);
		
		JMenuItem mntmNewMenuItem_1 = new JMenuItem("Manage users ");
		mnFiles.add(mntmNewMenuItem_1);
		
		JSeparator separator = new JSeparator();
		mnFiles.add(separator);
		
		JMenu mnNewMenu_1 = new JMenu("Style");
		menuBar.add(mnNewMenu_1);
		
		JMenuItem mntmAddStyle = new JMenuItem("Add New");
		mnNewMenu_1.add(mntmAddStyle);
		
		JSeparator separator_1 = new JSeparator();
		mnNewMenu_1.add(separator_1);
		
		JMenuItem mntmStyleVandA = new JMenuItem("View and Edit");
		mnNewMenu_1.add(mntmStyleVandA);
		
		JMenu mnRM = new JMenu("Raw Material");
		menuBar.add(mnRM);
		
		JMenuItem mntmRmAddNew = new JMenuItem("Add New");
		mnRM.add(mntmRmAddNew);
		
		JSeparator separator_2 = new JSeparator();
		mnRM.add(separator_2);
		
		JMenuItem mntmRmVandA = new JMenuItem("View and Edit");
		mnRM.add(mntmRmVandA);
		
		JMenu mnNewMenu = new JMenu("Find");
		menuBar.add(mnNewMenu);
		
		textField = new JTextField();
		mnNewMenu.add(textField);
		textField.setColumns(10);
		
		JSeparator separator_3 = new JSeparator();
		separator_3.setForeground(new Color(255, 255, 255));
		menuBar.add(separator_3);
		
		JButton btnRefresh = new JButton("Refresh");
		menuBar.add(btnRefresh);
		
		JButton btnLogOut = new JButton("Log-Out");
		menuBar.add(btnLogOut);
		contentPane = new JPanel();
		contentPane.setBorder(new EmptyBorder(5, 5, 5, 5));

		setContentPane(contentPane);
		contentPane.setLayout(null);
		
		JLabel lblNewLabel = new JLabel("");
		lblNewLabel.setAlignmentX(Component.CENTER_ALIGNMENT);
		lblNewLabel.setIcon(new ImageIcon("D:\\My Drive\\Business Use\\Eve Chantelle\\Branding\\ICON\\Undie 3.png"));
		lblNewLabel.setBounds(-239, -11, 1821, 439);
		contentPane.add(lblNewLabel);
	}
}
