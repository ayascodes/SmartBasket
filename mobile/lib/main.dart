import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'screens/connect_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ),
  );
  runApp(const SmartBasketApp());
}

class SmartBasketApp extends StatelessWidget {
  const SmartBasketApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Smart Basket · Lane',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF7CB9E8),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
      ),
      home: const ConnectScreen(),
    );
  }
}
