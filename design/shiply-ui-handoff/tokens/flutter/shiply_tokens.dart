// Shiply design tokens v1.0 for Flutter.
// Fonts: add the TTF files from /fonts to pubspec.yaml under the families "PlusJakartaSans" and "IBMPlexSansArabic".
import 'package:flutter/material.dart';

class ShiplyBrand {
  static const blue = Color(0xFF0047BB);
  static const sky = Color(0xFF59CBE8);
  static const navy = Color(0xFF13294B);
}

class ShiplyColors {
  const ShiplyColors._(this.bg, this.surface, this.surfaceRaised, this.line, this.text, this.textMuted, this.primary, this.onPrimary, this.primaryPressed, this.link, this.selectedBg, this.sky, this.focus, this.danger, this.statusNew, this.statusInProgress, this.statusHeadingToCustomer, this.statusDelivered, this.statusNeedsAction, this.statusReturning, this.cash, this.cashTint, this.cashInk, this.points, this.pointsTint, this.pointsInk);
  final Color bg;
  final Color surface;
  final Color surfaceRaised;
  final Color line;
  final Color text;
  final Color textMuted;
  final Color primary;
  final Color onPrimary;
  final Color primaryPressed;
  final Color link;
  final Color selectedBg;
  final Color sky;
  final Color focus;
  final Color danger;
  final Color statusNew;
  final Color statusInProgress;
  final Color statusHeadingToCustomer;
  final Color statusDelivered;
  final Color statusNeedsAction;
  final Color statusReturning;
  final Color cash;
  final Color cashTint;
  final Color cashInk;
  final Color points;
  final Color pointsTint;
  final Color pointsInk;

  static const light = ShiplyColors._(Color(0xFFF3F6FA), Color(0xFFFFFFFF), Color(0xFFF3F6FA), Color(0xFFDFE5EE), Color(0xFF13294B), Color(0xFF5B6B82), Color(0xFF0047BB), Color(0xFFFFFFFF), Color(0xFF003C9D), Color(0xFF0047BB), Color(0xFFE6F6FB), Color(0xFF59CBE8), Color(0xFF59CBE8), Color(0xFFDC2626), Color(0xFF64748B), Color(0xFF7C3AED), Color(0xFFC026D3), Color(0xFF16A34A), Color(0xFFD97706), Color(0xFFDC2626), Color(0xFF0E9384), Color(0xFFE1F5F2), Color(0xFF0B5F57), Color(0xFFFFC21A), Color(0xFFFFF6D6), Color(0xFF7A5200));
  static const dark = ShiplyColors._(Color(0xFF0B1424), Color(0xFF111E33), Color(0xFF18273F), Color(0xFF24344F), Color(0xFFE7EDF7), Color(0xFF93A3BC), Color(0xFF2F6BFF), Color(0xFFFFFFFF), Color(0xFF255BE0), Color(0xFF5B8CFF), Color(0xFF18273F), Color(0xFF59CBE8), Color(0xFF59CBE8), Color(0xFFF87171), Color(0xFF94A3B8), Color(0xFFA78BFA), Color(0xFFE879F9), Color(0xFF4ADE80), Color(0xFFFB923C), Color(0xFFF87171), Color(0xFF2DD4BF), Color(0x242DD4BF), Color(0xFF2DD4BF), Color(0xFFFFD34D), Color(0x24FFD34D), Color(0xFFFFD34D));
}

class ShiplyRadius { static const double sm = 6; static const double md = 10; static const double lg = 16; static const double xl = 24; static const double pill = 999; }
class ShiplySpace { static const double s1 = 4; static const double s2 = 8; static const double s3 = 12; static const double s4 = 16; static const double s5 = 20; static const double s6 = 24; static const double s7 = 32; static const double s8 = 40; static const double s9 = 48; static const double s10 = 64; }

ThemeData shiplyTheme(Brightness b) {
  final c = b == Brightness.dark ? ShiplyColors.dark : ShiplyColors.light;
  return ThemeData(
    useMaterial3: true,
    brightness: b,
    fontFamily: 'PlusJakartaSans',
    scaffoldBackgroundColor: c.bg,
    colorScheme: ColorScheme(
      brightness: b, primary: c.primary, onPrimary: c.onPrimary, secondary: ShiplyBrand.sky, onSecondary: ShiplyBrand.navy,
      error: c.danger, onError: Colors.white, surface: c.surface, onSurface: c.text,
    ),
    textTheme: const TextTheme(
      displayMedium: TextStyle(fontSize: 40, height: 1.05, fontWeight: FontWeight.w800, letterSpacing: -1.40),
      headlineLarge: TextStyle(fontSize: 32, height: 1.1, fontWeight: FontWeight.w800, letterSpacing: -0.96),
      headlineMedium: TextStyle(fontSize: 24, height: 1.2, fontWeight: FontWeight.w700, letterSpacing: -0.48),
      titleLarge: TextStyle(fontSize: 18, height: 1.35, fontWeight: FontWeight.w700, letterSpacing: -0.18),
      bodyLarge: TextStyle(fontSize: 16, height: 1.6, fontWeight: FontWeight.w400, letterSpacing: 0.00),
      bodyMedium: TextStyle(fontSize: 14, height: 1.5, fontWeight: FontWeight.w400, letterSpacing: 0.00),
      bodySmall: TextStyle(fontSize: 12, height: 1.4, fontWeight: FontWeight.w500, letterSpacing: 0.00),
    ),
  );
}
