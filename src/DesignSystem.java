import java.awt.Window;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.prefs.Preferences;

import javax.swing.ButtonGroup;
import javax.swing.JMenu;
import javax.swing.JRadioButtonMenuItem;
import javax.swing.SwingUtilities;

import com.formdev.flatlaf.FlatLaf;
import com.formdev.flatlaf.FlatLightLaf;
import com.formdev.flatlaf.themes.FlatMacLightLaf;

/**
 * Swing themes based on the color, shape and type tokens of popular design systems.
 * Built on FlatLaf (lib/flatlaf-3.7.2.jar).
 *
 * Usage: call DesignSystem.applySaved() at the top of main(),
 * and add DesignSystem.createMenu() to a menu bar to let the user switch.
 */
public enum DesignSystem
{
    // Google Material Design 3, baseline light scheme
    MATERIAL("Material Design", false, tokens(
        "@accentColor", "#6750A4",
        "@background", "#FEF7FF",
        "@foreground", "#1D1B20",
        "Component.borderColor", "#79747E",
        "Component.focusColor", "#6750A4",
        "Button.default.background", "#6750A4",
        "Button.default.foreground", "#FFFFFF",
        "Button.arc", "999",
        "Component.arc", "8",
        "TextComponent.arc", "4",
        "defaultFont", "14 \"Roboto\", \"Segoe UI\", sans-serif")),

    // Microsoft Fluent 2, web light theme
    FLUENT("Fluent UI", false, tokens(
        "@accentColor", "#0F6CBD",
        "@background", "#FAFAFA",
        "@foreground", "#242424",
        "Component.borderColor", "#D1D1D1",
        "Component.focusColor", "#0F6CBD",
        "Button.default.background", "#0F6CBD",
        "Button.default.foreground", "#FFFFFF",
        "Button.arc", "4",
        "Component.arc", "4",
        "TextComponent.arc", "4",
        "defaultFont", "14 \"Segoe UI Variable\", \"Segoe UI\", sans-serif")),

    // IBM Carbon, White theme
    CARBON("Carbon Design System", false, tokens(
        "@accentColor", "#0F62FE",
        "@background", "#FFFFFF",
        "@foreground", "#161616",
        "Component.borderColor", "#8D8D8D",
        "Component.focusColor", "#0F62FE",
        "Button.default.background", "#0F62FE",
        "Button.default.foreground", "#FFFFFF",
        "TextField.background", "#F4F4F4",
        "Button.arc", "0",
        "Component.arc", "0",
        "TextComponent.arc", "0",
        "defaultFont", "14 \"IBM Plex Sans\", \"Helvetica Neue\", sans-serif")),

    // Shopify Polaris
    POLARIS("Shopify Polaris", false, tokens(
        "@accentColor", "#005BD3",
        "@background", "#F1F1F1",
        "@foreground", "#303030",
        "Component.borderColor", "#8A8A8A",
        "Component.focusColor", "#005BD3",
        "Button.default.background", "#303030",
        "Button.default.foreground", "#FFFFFF",
        "Button.arc", "8",
        "Component.arc", "8",
        "TextComponent.arc", "8",
        "defaultFont", "13 \"Inter\", \"Segoe UI\", sans-serif")),

    // Apple Human Interface Guidelines (macOS look)
    HIG("Apple Human Interface Guidelines", true, tokens(
        "@accentColor", "#007AFF",
        "defaultFont", "13 \"SF Pro Text\", \".AppleSystemUIFont\", \"Helvetica Neue\", sans-serif")),

    // Stripe (Elements and Stripe Apps UI)
    STRIPE("Stripe", false, tokens(
        "@accentColor", "#635BFF",
        "@background", "#F6F9FC",
        "@foreground", "#30313D",
        "Component.borderColor", "#E6EBF1",
        "Component.focusColor", "#635BFF",
        "Button.default.background", "#635BFF",
        "Button.default.foreground", "#FFFFFF",
        "TextField.background", "#FFFFFF",
        "Button.arc", "8",
        "Component.arc", "6",
        "TextComponent.arc", "6",
        "defaultFont", "14 \"Sohne\", \"Segoe UI\", \"Helvetica Neue\", sans-serif"));

    private static final String PREF_KEY = "designSystem";

    public final String displayName;
    private final boolean macBase;
    private final Map<String, String> tokens;

    DesignSystem(String _displayName, boolean _macBase, Map<String, String> _tokens)
    {
        displayName = _displayName;
        macBase = _macBase;
        tokens = _tokens;
    }

    /** Installs this theme and repaints any open windows. */
    public void apply()
    {
        FlatLaf.setGlobalExtraDefaults(tokens);
        if (macBase)
            FlatMacLightLaf.setup();
        else
            FlatLightLaf.setup();

        for (Window window : Window.getWindows())
            SwingUtilities.updateComponentTreeUI(window);

        prefs().put(PREF_KEY, name());
    }

    /** Applies the last chosen theme, or Material Design on first run. */
    public static void applySaved()
    {
        DesignSystem saved = MATERIAL;
        try
        {
            saved = valueOf(prefs().get(PREF_KEY, MATERIAL.name()));
        }
        catch (IllegalArgumentException e)
        {
            // unknown value from an older version, keep the default
        }
        saved.apply();
    }

    /** A "Design System" menu with one radio item per theme. */
    public static JMenu createMenu()
    {
        JMenu menu = new JMenu("Design System");
        ButtonGroup group = new ButtonGroup();
        String current = prefs().get(PREF_KEY, MATERIAL.name());

        for (DesignSystem ds : values())
        {
            JRadioButtonMenuItem item = new JRadioButtonMenuItem(ds.displayName);
            item.setSelected(ds.name().equals(current));
            item.addActionListener(e -> ds.apply());
            group.add(item);
            menu.add(item);
        }
        return menu;
    }

    private static Preferences prefs()
    {
        return Preferences.userNodeForPackage(DesignSystem.class);
    }

    private static Map<String, String> tokens(String... keyValues)
    {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2)
            map.put(keyValues[i], keyValues[i + 1]);
        return map;
    }
}
