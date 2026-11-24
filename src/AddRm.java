import java.awt.Dimension;
import java.awt.EventQueue;

import javax.swing.JFrame;
import javax.swing.JPanel;
import javax.swing.JLabel;
import java.awt.Font;
import javax.swing.JButton;
import java.awt.event.ActionListener;
import java.awt.event.ActionEvent;
import javax.swing.JSeparator;
import javax.swing.JComboBox;
import javax.swing.DefaultComboBoxModel;
import javax.swing.JTextField;

public class AddRm extends JFrame {

	private JPanel contentPane;
	private JTextField textRmName;
	private JTextField textFieldRmCode;
	private JTextField textFieldRmPrice;

	/**
	 * Launch the application.
	 */
	public static void main(String[] args) {
		EventQueue.invokeLater(new Runnable() {
			public void run() {
				try {
					AddRm frame = new AddRm();
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
	public AddRm() {
		setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
		Branding.applyFrame(this, "Add Raw Material");
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
		
		contentPane.add(Branding.header("Add Raw Material", 450, 70));
		
		JLabel lblRmName = new JLabel("Raw Material Name");
		Branding.label(lblRmName);
		lblRmName.setBounds(50, 44, 165, 22);
		panel.add(lblRmName);
		
		JLabel lblRmType = new JLabel("Pick measurement Type");
		Branding.label(lblRmType);
		lblRmType.setBounds(50, 118, 165, 22);
		panel.add(lblRmType);
		
		JLabel lblRmPrice = new JLabel("Raw Material Price");
		Branding.label(lblRmPrice);
		lblRmPrice.setBounds(50, 151, 165, 22);
		panel.add(lblRmPrice);
		
		JLabel lblAddRawMaterial = new JLabel("Raw Material Details");
		lblAddRawMaterial.setFont(Branding.font(Font.BOLD, 15));
		lblAddRawMaterial.setForeground(Branding.NAVY);
		lblAddRawMaterial.setBounds(50, 6, 200, 22);
		panel.add(lblAddRawMaterial);
		
		JButton btnSave = new JButton("Save");
		Branding.primaryButton(btnSave);
		btnSave.setBounds(50, 205, 100, 30);
		panel.add(btnSave);
		
		JButton btnReset = new JButton("Reset");
		btnReset.addActionListener(new ActionListener() {
			public void actionPerformed(ActionEvent e) {
			}
		});
		Branding.secondaryButton(btnReset);
		btnReset.setBounds(172, 205, 100, 30);
		panel.add(btnReset);
		
		JButton btnExit = new JButton("Exit");
		Branding.outlineButton(btnExit);
		btnExit.setBounds(295, 205, 100, 30);
		panel.add(btnExit);
		
		JLabel lblRawMaterialCode = new JLabel("Raw Material Code");
		Branding.label(lblRawMaterialCode);
		lblRawMaterialCode.setBounds(50, 77, 165, 22);
		panel.add(lblRawMaterialCode);
		
		JSeparator separator = new JSeparator();
		separator.setBounds(50, 31, 345, 2);
		panel.add(separator);
		
		JSeparator separator_1 = new JSeparator();
		separator_1.setBounds(50, 184, 345, 2);
		panel.add(separator_1);
		
		JComboBox comboBox = new JComboBox();
		comboBox.setToolTipText("125\r\n");
		comboBox.setModel(new DefaultComboBoxModel(new String[] {"Please pick one", "KG", "CM", "Per Unit"}));
		comboBox.setFont(Branding.labelFont());
		comboBox.setBackground(Branding.WHITE);
		comboBox.setForeground(Branding.NAVY);
		comboBox.setBounds(222, 117, 173, 24);
		panel.add(comboBox);
		
		textRmName = new JTextField();
		Branding.input(textRmName);
		textRmName.setBounds(222, 44, 173, 24);
		panel.add(textRmName);
		textRmName.setColumns(10);
		
		textFieldRmCode = new JTextField();
		textFieldRmCode.setColumns(10);
		Branding.input(textFieldRmCode);
		textFieldRmCode.setBounds(222, 77, 173, 24);
		panel.add(textFieldRmCode);
		
		textFieldRmPrice = new JTextField();
		textFieldRmPrice.setColumns(10);
		Branding.input(textFieldRmPrice);
		textFieldRmPrice.setBounds(222, 149, 173, 24);
		panel.add(textFieldRmPrice);
		
		pack();
		setLocationRelativeTo(null);
	}
}
