import java.awt.Dimension;
import java.awt.EventQueue;

import javax.swing.JFrame;
import javax.swing.JPanel;
import javax.swing.JLabel;
import javax.swing.JPasswordField;
import javax.swing.JTextField;
import javax.swing.JButton;
import java.awt.event.ActionListener;
import java.awt.event.ActionEvent;
import java.awt.Font;
import javax.swing.JSeparator;
import javax.swing.SwingConstants;

public class LoginGui extends JFrame {

	private JPanel contentPane;
	private JPasswordField passwordField;
	private JTextField textField;

	/**
	 * Launch the application.
	 */
	public static void main(String[] args) {
		EventQueue.invokeLater(new Runnable() {
			public void run() {
				try {
					LoginGui frame = new LoginGui();
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
	public LoginGui() {
		setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
		Branding.applyFrame(this, "Login");
		setResizable(false);
		contentPane = new JPanel();
		contentPane.setBackground(Branding.WHITE);
		contentPane.setPreferredSize(new Dimension(450, 400));

		setContentPane(contentPane);
		contentPane.setLayout(null);

		JPanel brandPanel = new JPanel(null);
		brandPanel.setBackground(Branding.YELLOW);
		brandPanel.setBounds(0, 0, 450, 150);
		contentPane.add(brandPanel);

		JLabel logo = Branding.logo(220);
		logo.setBounds(115, 12, 220, 112);
		brandPanel.add(logo);

		JLabel lblTagline = new JLabel(Branding.TAGLINE);
		lblTagline.setFont(Branding.font(Font.PLAIN, 12));
		lblTagline.setForeground(Branding.NAVY);
		lblTagline.setHorizontalAlignment(SwingConstants.CENTER);
		lblTagline.setBounds(0, 124, 450, 20);
		brandPanel.add(lblTagline);

		JLabel lblNewLabel = new JLabel("Login");
		lblNewLabel.setFont(Branding.titleFont());
		lblNewLabel.setForeground(Branding.NAVY);
		lblNewLabel.setHorizontalAlignment(SwingConstants.CENTER);
		lblNewLabel.setBounds(0, 160, 450, 30);
		contentPane.add(lblNewLabel);

		JSeparator separator_1 = new JSeparator();
		separator_1.setForeground(Branding.YELLOW);
		separator_1.setBounds(175, 194, 100, 2);
		contentPane.add(separator_1);

		JLabel lblUsername = new JLabel("Username");
		Branding.label(lblUsername);
		lblUsername.setBounds(70, 213, 90, 20);
		contentPane.add(lblUsername);

		textField = new JTextField();
		Branding.input(textField);
		textField.setBounds(165, 208, 215, 28);
		contentPane.add(textField);
		textField.setColumns(10);

		JLabel lblPassword = new JLabel("Password");
		Branding.label(lblPassword);
		lblPassword.setBounds(70, 258, 90, 20);
		contentPane.add(lblPassword);

		passwordField = new JPasswordField();
		Branding.input(passwordField);
		passwordField.setBounds(165, 253, 215, 28);
		contentPane.add(passwordField);

		JSeparator separator = new JSeparator();
		separator.setBounds(40, 305, 370, 2);
		contentPane.add(separator);

		JButton btnlogin = new JButton("Login");
		Branding.primaryButton(btnlogin);
		btnlogin.addActionListener(new ActionListener() {
			public void actionPerformed(ActionEvent e) {
			}
		});
		btnlogin.setBounds(40, 330, 110, 32);
		contentPane.add(btnlogin);

		JButton btnReset = new JButton("Reset");
		Branding.secondaryButton(btnReset);
		btnReset.addActionListener(new ActionListener() {
			public void actionPerformed(ActionEvent e) {
			}
		});
		btnReset.setBounds(170, 330, 110, 32);
		contentPane.add(btnReset);

		JButton btnExit = new JButton("Exit");
		Branding.outlineButton(btnExit);
		btnExit.setBounds(300, 330, 110, 32);
		contentPane.add(btnExit);

		pack();
		setLocationRelativeTo(null);
	}

}
