import java.awt.EventQueue;

import javax.swing.JFrame;
import javax.swing.JPanel;
import javax.swing.border.EmptyBorder;
import java.awt.Color;
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
		setBounds(100, 100, 450, 300);
		contentPane = new JPanel();
		contentPane.setBorder(new EmptyBorder(5, 5, 5, 5));

		setContentPane(contentPane);
		contentPane.setLayout(null);
		
		JPanel panel = new JPanel();
		panel.setBackground(new Color(255, 128, 255));
		panel.setBounds(0, 0, 434, 261);
		contentPane.add(panel);
		panel.setLayout(null);
		
		JLabel lblRmName = new JLabel("Raw Material Name");
		lblRmName.setFont(new Font("Times New Roman", Font.PLAIN, 15));
		lblRmName.setBounds(50, 44, 126, 22);
		panel.add(lblRmName);
		
		JLabel lblRmType = new JLabel("Pick measurement Type");
		lblRmType.setFont(new Font("Times New Roman", Font.PLAIN, 15));
		lblRmType.setBounds(50, 118, 152, 22);
		panel.add(lblRmType);
		
		JLabel lblRmPrice = new JLabel("Raw Material Price");
		lblRmPrice.setFont(new Font("Times New Roman", Font.PLAIN, 15));
		lblRmPrice.setBounds(50, 151, 140, 22);
		panel.add(lblRmPrice);
		
		JLabel lblAddRawMaterial = new JLabel("Add Raw Material");
		lblAddRawMaterial.setFont(new Font("Times New Roman", Font.PLAIN, 15));
		lblAddRawMaterial.setBounds(157, 11, 120, 22);
		panel.add(lblAddRawMaterial);
		
		JButton btnSave = new JButton("Save");
		btnSave.setBounds(50, 197, 89, 23);
		panel.add(btnSave);
		
		JButton btnReset = new JButton("Reset");
		btnReset.addActionListener(new ActionListener() {
			public void actionPerformed(ActionEvent e) {
			}
		});
		btnReset.setBounds(176, 197, 89, 23);
		panel.add(btnReset);
		
		JButton btnExit = new JButton("Exit");
		btnExit.setBounds(306, 197, 89, 23);
		panel.add(btnExit);
		
		JLabel lblRawMaterialCode = new JLabel("Raw Material Code");
		lblRawMaterialCode.setFont(new Font("Times New Roman", Font.PLAIN, 15));
		lblRawMaterialCode.setBounds(50, 77, 126, 22);
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
		comboBox.setBounds(212, 119, 89, 22);
		panel.add(comboBox);
		
		textRmName = new JTextField();
		textRmName.setBounds(212, 46, 183, 20);
		panel.add(textRmName);
		textRmName.setColumns(10);
		
		textFieldRmCode = new JTextField();
		textFieldRmCode.setColumns(10);
		textFieldRmCode.setBounds(212, 79, 183, 20);
		panel.add(textFieldRmCode);
		
		textFieldRmPrice = new JTextField();
		textFieldRmPrice.setColumns(10);
		textFieldRmPrice.setBounds(212, 151, 183, 20);
		panel.add(textFieldRmPrice);
	}
}
