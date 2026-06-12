import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../theme/app_colors.dart';
import 'lane_screen.dart';

const _kUrlKey = 'server_url';

class ConnectScreen extends StatefulWidget {
  const ConnectScreen({super.key});

  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  final _ctrl = TextEditingController();
  String? _savedUrl;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadSaved();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _loadSaved() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_kUrlKey);
    setState(() {
      _savedUrl = saved;
      if (saved != null) _ctrl.text = saved;
      _loading = false;
    });
  }

  Future<void> _connect() async {
    final url = _ctrl.text.trim();
    if (url.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kUrlKey, url);
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => LaneScreen(serverUrl: url)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 24),
                    _header(),
                    const SizedBox(height: 40),
                    if (_savedUrl != null) ...[
                      _savedCard(),
                      const SizedBox(height: 28),
                      _divider(),
                      const SizedBox(height: 28),
                    ],
                    _urlField(),
                    const SizedBox(height: 20),
                    _connectButton(),
                    const SizedBox(height: 24),
                    _hint(),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _header() {
    return Column(
      children: [
        Container(
          width: 72,
          height: 72,
          decoration: BoxDecoration(
            color: AppColors.skySoft,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: AppColors.line),
          ),
          child: const Icon(Icons.shopping_basket_rounded,
              color: AppColors.sky, size: 36),
        ),
        const SizedBox(height: 16),
        const Text(
          'Smart Basket',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 26,
            fontWeight: FontWeight.w700,
            color: AppColors.ink,
            letterSpacing: -0.5,
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'Enter your AI server URL to start scanning',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 14, color: AppColors.ink3),
        ),
      ],
    );
  }

  Widget _savedCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.greenSoft,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.green.withAlpha(80)),
      ),
      child: Row(
        children: [
          const Icon(Icons.link_rounded, color: Color(0xFF1D8B53), size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Saved server',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF1D8B53),
                    letterSpacing: 0.5,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _savedUrl!,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.ink2,
                    fontFamily: 'monospace',
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: () {
              _ctrl.text = _savedUrl!;
              _connect();
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: AppColors.green,
                borderRadius: BorderRadius.circular(9),
              ),
              child: const Text(
                'Use',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _divider() {
    return Row(
      children: [
        const Expanded(child: Divider(color: AppColors.line)),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Text(
            'or enter a new URL',
            style: TextStyle(fontSize: 12, color: AppColors.ink4),
          ),
        ),
        const Expanded(child: Divider(color: AppColors.line)),
      ],
    );
  }

  Widget _urlField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Server URL',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.ink2,
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _ctrl,
          keyboardType: TextInputType.url,
          autocorrect: false,
          onSubmitted: (_) => _connect(),
          decoration: InputDecoration(
            hintText: 'https://xxxx.ngrok-free.app',
            hintStyle: TextStyle(color: AppColors.ink4, fontFamily: 'monospace'),
            prefixIcon: const Icon(Icons.wifi_rounded, color: AppColors.ink3),
            filled: true,
            fillColor: AppColors.white,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(13),
              borderSide: BorderSide(color: AppColors.line),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(13),
              borderSide: BorderSide(color: AppColors.line),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(13),
              borderSide: BorderSide(color: AppColors.sky, width: 2),
            ),
          ),
          style: const TextStyle(fontSize: 14, fontFamily: 'monospace'),
        ),
      ],
    );
  }

  Widget _connectButton() {
    return GestureDetector(
      onTap: _connect,
      child: Container(
        height: 52,
        decoration: BoxDecoration(
          color: AppColors.sky,
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
              color: AppColors.sky.withAlpha(100),
              blurRadius: 16,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 18),
            SizedBox(width: 8),
            Text(
              'Connect',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 16,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _hint() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.skySoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
      ),
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline_rounded, size: 16, color: AppColors.skyDeep),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              'Run the Kaggle notebook first, then paste the ngrok URL printed at the bottom of the last cell.',
              style: TextStyle(fontSize: 12, color: AppColors.ink2, height: 1.5),
            ),
          ),
        ],
      ),
    );
  }
}
