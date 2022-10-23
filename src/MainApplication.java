import javax.swing.JPanel;
import javax.swing.JList;
import javax.swing.JButton;

public class MainApplication extends JPanel {

	/**
	 * Create the panel.
	 */
	public MainApplication() {
		setLayout(null);
		
		JList list = new JList();
		list.setBounds(10, 11, 224, 134);
		add(list);
		
		JButton newStyleButton = new JButton("New button");
		newStyleButton.setBounds(308, 11, 89, 23);
		add(newStyleButton);

	}
}
