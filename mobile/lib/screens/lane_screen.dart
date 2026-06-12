import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:camera/camera.dart';
import 'package:image/image.dart' as img;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../theme/app_colors.dart';
import 'connect_screen.dart';
import '../models/product.dart';
import '../models/receipt_line.dart';
import '../data/products_data.dart';

// ── Isolate-safe frame encoder (must be top-level for compute()) ─────────────
//
// Runs in a background isolate — never blocks the UI thread.
// Accepts a plain Map so it can cross the isolate boundary via SendPort.
//
// Input resolution: whatever the camera delivers (high preset ≈ 1280×720).
// Output: 480-wide JPEG at quality 72 — good enough for DINOv2, low bandwidth.
String? _encodeFrame(Map<String, Object> d) {
  try {
    final w   = d['w']   as int;
    final h   = d['h']   as int;
    final p0  = d['p0']  as Uint8List; // Y  (YUV) or BGRA (iOS)
    final p1  = d['p1']  as Uint8List; // U
    final p2  = d['p2']  as Uint8List; // V
    final s0  = d['s0']  as int;       // row stride of plane 0
    final s1  = d['s1']  as int;       // row stride of UV plane
    final ps1 = d['ps1'] as int;       // pixel stride of UV plane
    final yuv = (d['yuv'] as int) == 1;

    const outW = 480;
    final outH = (outW * h / w).round().clamp(240, 640);
    final out  = img.Image(width: outW, height: outH);

    final xScale = w / outW;
    final yScale = h / outH;

    if (yuv) {
      // ── Android YUV420: subsampled BT.601 integer conversion ──────────────
      // Iterates only outW×outH pixels — ~130 K ops for 480×270, fast enough.
      for (int ty = 0; ty < outH; ty++) {
        final sy  = (ty * yScale).toInt().clamp(0, h - 1);
        final uvy = sy >> 1;
        for (int tx = 0; tx < outW; tx++) {
          final sx  = (tx * xScale).toInt().clamp(0, w - 1);
          final yv  = p0[sy * s0 + sx] & 0xFF;
          final uvx = sx >> 1;
          final off = uvy * s1 + uvx * ps1;
          final uv  = (off < p1.length) ? p1[off] & 0xFF : 128;
          final vv  = (off < p2.length) ? p2[off] & 0xFF : 128;
          final c   = yv - 16;
          final dd  = uv - 128;
          final e   = vv - 128;
          out.setPixelRgb(
            tx, ty,
            ((298 * c + 409 * e        + 128) >> 8).clamp(0, 255),
            ((298 * c - 100 * dd - 208 * e + 128) >> 8).clamp(0, 255),
            ((298 * c + 516 * dd       + 128) >> 8).clamp(0, 255),
          );
        }
      }
    } else {
      // ── iOS BGRA8888 ───────────────────────────────────────────────────────
      for (int ty = 0; ty < outH; ty++) {
        final sy = (ty * yScale).toInt().clamp(0, h - 1);
        for (int tx = 0; tx < outW; tx++) {
          final sx  = (tx * xScale).toInt().clamp(0, w - 1);
          final idx = sy * s0 + sx * 4;
          out.setPixelRgb(tx, ty, p0[idx + 2], p0[idx + 1], p0[idx]);
        }
      }
    }

    final jpeg = img.encodeJpg(out, quality: 72);
    return base64Encode(jpeg);
  } catch (_) {
    return null;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

enum _ScanState { idle, scanning, recognized }
enum _ToastKind { ok, info, warn }

class _Toast {
  final String id;
  final String message;
  final _ToastKind kind;
  _Toast(this.id, this.message, this.kind);
}

class _DetectionEvent {
  final String label;
  final double sim;
  final bool isUnknown;
  const _DetectionEvent({
    required this.label,
    required this.sim,
    required this.isUnknown,
  });
}

class LaneScreen extends StatefulWidget {
  const LaneScreen({super.key, required this.serverUrl});
  final String serverUrl;
  @override
  State<LaneScreen> createState() => _LaneScreenState();
}

class _LaneScreenState extends State<LaneScreen> with TickerProviderStateMixin {
  _ScanState _scan = _ScanState.idle;
  Product?   _product;
  int?       _vi;
  double     _conf  = 0;
  bool       _added = false;
  final List<ReceiptLine> _receipt = [];
  final List<_Toast>      _toasts  = [];
  final List<Timer>       _timers  = [];

  // ── Camera height (resizable by drag) ────────────────────────────────────
  double _cameraHeight = 160.0;
  static const double _cameraMinH = 100.0;
  static const double _cameraMaxH = 480.0;

  // ── WebSocket / camera ───────────────────────────────────────────────────
  WebSocketChannel? _channel;
  CameraController? _cameraCtrl;
  bool _streaming  = false;

  // Frame-send lifecycle:
  //   _capturing  = compute() isolate is running — drop new frames
  //   _pendingSend = frame was sent, waiting for the next server message (RTT gate)
  //   _responseTimeout = safety valve if server goes silent
  bool   _capturing    = false;
  bool   _pendingSend  = false;
  Timer? _responseTimeout;

  // Motion gate: 64 Y-plane samples from the last transmitted frame
  List<int>? _lastYSample;

  Uint8List? _serverFrame;
  String?    _lastLockedLabel;
  String?    _wsError;

  // ── Detection popup ───────────────────────────────────────────────────────
  _DetectionEvent?        _detectionEvent;
  Timer?                  _popupTimer;
  final Map<int, DateTime> _trackFirstSeen  = {};
  final Set<int>           _popupShownFor   = {};
  final Set<String>        _userEditedPids  = {};

  late final AnimationController _scanLineCtrl;
  late final AnimationController _liveDotCtrl;
  late final AnimationController _heroCtrl;
  late final AnimationController _confCtrl;
  late final AnimationController _floatCtrl;
  late final Animation<double>   _scanLinePos;
  late final Animation<Offset>   _heroSlide;
  late final Animation<double>   _heroBrightness;
  late final Animation<double>   _floatOffset;

  late Timer   _clockTimer;
  DateTime     _now = DateTime.now();

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  @override
  void initState() {
    super.initState();

    _scanLineCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1250),
    );
    _scanLinePos = Tween<double>(begin: 0, end: 1).animate(_scanLineCtrl);

    _liveDotCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat();

    _heroCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
    );
    _heroSlide = Tween<Offset>(
      begin: const Offset(0, 0.06),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _heroCtrl, curve: Curves.easeOutCubic));
    _heroBrightness =
        CurvedAnimation(parent: _heroCtrl, curve: Curves.easeOut);

    _confCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );

    _floatCtrl = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 3),
    )..repeat(reverse: true);
    _floatOffset = Tween<double>(begin: 0, end: -8).animate(
      CurvedAnimation(parent: _floatCtrl, curve: Curves.easeInOut),
    );

    _clockTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });

    _connectToServer();
  }

  @override
  void dispose() {
    for (final t in _timers) { t.cancel(); }
    _clockTimer.cancel();
    _responseTimeout?.cancel();
    _popupTimer?.cancel();
    _channel?.sink.close();
    _stopStream();
    _cameraCtrl?.dispose();
    _scanLineCtrl.dispose();
    _liveDotCtrl.dispose();
    _heroCtrl.dispose();
    _confCtrl.dispose();
    _floatCtrl.dispose();
    super.dispose();
  }

  // ── Connection bootstrap ─────────────────────────────────────────────────

  Future<void> _connectToServer() async {
    await _initCamera();
    _openWebSocket();
  }

  Future<void> _initCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) return;
      final camera = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.back,
        orElse: () => cameras.first,
      );
      // ResolutionPreset.high = 1280×720 on most devices.
      // Gives good FOV and produces ~900 KB YUV frames — manageable for streaming.
      // imageFormatGroup.yuv420 is the only format guaranteed on Android streams.
      _cameraCtrl = CameraController(
        camera,
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.yuv420,
      );
      await _cameraCtrl!.initialize();
      try {
        await _cameraCtrl!.setZoomLevel(
          await _cameraCtrl!.getMinZoomLevel(),
        );
      } catch (_) {}
    } catch (_) {}
  }

  Future<void> _openWebSocket() async {
    try {
      var url = widget.serverUrl.trim();
      while (url.endsWith('/')) { url = url.substring(0, url.length - 1); }
      url = url
          .replaceFirst('https://', 'wss://')
          .replaceFirst('http://', 'ws://');
      if (!url.endsWith('/ws')) url = '$url/ws';

      _channel = WebSocketChannel.connect(Uri.parse(url));
      await _channel!.ready;
      if (!mounted) return;

      _channel!.stream.listen(
        _onServerMessage,
        onDone: _onDisconnected,
        onError: (_) => _onDisconnected(),
        cancelOnError: true,
      );
      setState(() { _streaming = true; _wsError = null; });
      _startStream();
      _scanLineCtrl.repeat();
    } catch (e) {
      _channel = null;
      if (!mounted) return;
      setState(() { _streaming = false; _wsError = 'Cannot reach server'; });
      Future.delayed(const Duration(seconds: 4), () {
        if (mounted && !_streaming) _openWebSocket();
      });
    }
  }

  // ── Camera stream ─────────────────────────────────────────────────────────

  void _startStream() {
    if (_cameraCtrl == null || !_cameraCtrl!.value.isInitialized) return;
    try {
      _cameraCtrl!.startImageStream(_onCameraFrame);
    } catch (_) {}
  }

  void _stopStream() {
    _capturing   = false;
    _pendingSend = false;
    _responseTimeout?.cancel();
    _lastYSample = null;
    try { _cameraCtrl?.stopImageStream(); } catch (_) {}
  }

  // Called on the camera thread for every frame the sensor produces.
  // Must return quickly — heavy work goes to compute().
  void _onCameraFrame(CameraImage image) {
    // Gate 1: already busy (compute running or waiting for server ack)
    if (_capturing || !_streaming || _channel == null) return;
    // Gate 2: scene hasn't changed — skip to reduce unnecessary traffic
    if (!_motionDetected(image)) return;

    final isYuv  = image.format.group == ImageFormatGroup.yuv420;
    final isBgra = image.format.group == ImageFormatGroup.bgra8888;
    if (!isYuv && !isBgra) return;

    _capturing = true;

    // Copy plane bytes before they're recycled by the camera buffer pool.
    final frameData = <String, Object>{
      'w':   image.width,
      'h':   image.height,
      'p0':  Uint8List.fromList(image.planes[0].bytes),
      'p1':  image.planes.length > 1
             ? Uint8List.fromList(image.planes[1].bytes) : Uint8List(0),
      'p2':  image.planes.length > 2
             ? Uint8List.fromList(image.planes[2].bytes) : Uint8List(0),
      's0':  image.planes[0].bytesPerRow,
      's1':  image.planes.length > 1 ? image.planes[1].bytesPerRow : 0,
      'ps1': image.planes.length > 1
             ? (image.planes[1].bytesPerPixel ?? 1) : 1,
      'yuv': isYuv ? 1 : 0,
    };

    compute(_encodeFrame, frameData).then((b64) {
      if (!mounted) { _capturing = false; return; }
      if (b64 != null && _channel != null) {
        try {
          _channel!.sink.add(jsonEncode({'image': b64}));
          // RTT gate: hold _capturing = true until server acknowledges this frame.
          // _onServerMessage will clear it. Safety timeout covers silent servers.
          _pendingSend = true;
          _responseTimeout?.cancel();
          _responseTimeout = Timer(const Duration(milliseconds: 1400), () {
            _pendingSend = false;
            _capturing   = false;
          });
        } catch (_) {
          _capturing = false;
        }
      } else {
        _capturing = false;
      }
    }).catchError((_) { _capturing = false; });
  }

  // Lightweight motion detector: samples 64 points from the Y plane and
  // computes average absolute difference versus the previous transmitted frame.
  bool _motionDetected(CameraImage image) {
    final yBytes = image.planes[0].bytes;
    if (yBytes.isEmpty) return true;
    const n    = 64;
    final step = (yBytes.length ~/ n).clamp(1, yBytes.length);
    final cur  = List<int>.generate(
      n,
      (i) => yBytes[(i * step).clamp(0, yBytes.length - 1)] & 0xFF,
    );
    final prev = _lastYSample;
    _lastYSample = cur;
    if (prev == null) return true;
    int diff = 0;
    for (int i = 0; i < n; i++) { diff += (cur[i] - prev[i]).abs(); }
    return diff > n * 5; // avg ≥5 luminance-unit shift per sample
  }

  // ── WebSocket handlers ───────────────────────────────────────────────────

  void _onDisconnected() {
    if (!mounted) return;
    _stopStream();
    _scanLineCtrl.stop();
    setState(() { _streaming = false; _wsError = 'Disconnected'; });
    Future.delayed(const Duration(seconds: 4), () {
      if (mounted && !_streaming) _openWebSocket();
    });
  }

  void _disconnectAndGoBack() {
    _stopStream();
    _responseTimeout?.cancel();
    _popupTimer?.cancel();
    _channel?.sink.close();
    _cameraCtrl?.dispose();
    _cameraCtrl = null;
    _channel     = null;
    if (mounted) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const ConnectScreen()),
      );
    }
  }

  void _onServerMessage(dynamic message) {
    if (!mounted) return;

    // RTT gate: server responded — allow the next frame immediately.
    if (_pendingSend) {
      _pendingSend = false;
      _capturing   = false;
      _responseTimeout?.cancel();
    }

    try {
      final data     = jsonDecode(message as String) as Map<String, dynamic>;
      final imgData  = data['image'];
      if (imgData != null) {
        setState(() => _serverFrame = base64Decode(imgData as String));
      }
      final raw = (data['session_receipt'] as Map?)?.cast<String, dynamic>() ?? {};
      _syncReceiptFromServer(raw);
      final products = (data['products'] as Map?)?.cast<String, dynamic>() ?? {};
      _updateStageFromProducts(products);
    } catch (_) {}
  }

  void _syncReceiptFromServer(Map<String, dynamic> serverReceipt) {
    if (!mounted) return;
    if (serverReceipt.isEmpty) {
      if (_userEditedPids.isNotEmpty) {
        setState(() => _userEditedPids.clear());
      }
      return;
    }
    setState(() {
      for (final entry in serverReceipt.entries) {
        final label     = entry.key;
        final serverQty = (entry.value as num).toInt();
        if (serverQty <= 0) continue;
        if (_userEditedPids.contains(label)) continue;
        final idx = _receipt.indexWhere((l) => l.pid == label);
        if (idx >= 0) {
          if (serverQty > _receipt[idx].qty) {
            _receipt[idx] = _receipt[idx].copyWith(qty: serverQty);
          }
        } else {
          _receipt.add(ReceiptLine(
            key:     label,
            pid:     label,
            product: Product.fromServer(label),
            variant: null,
            unit:    0,
            qty:     serverQty,
          ));
        }
      }
    });
  }

  void _updateStageFromProducts(Map<String, dynamic> products) {
    if (!mounted) return;
    final now       = DateTime.now();
    final activeIds = <int>{};

    for (final entry in products.entries) {
      final trackId = int.tryParse(entry.key.toString()) ?? 0;
      activeIds.add(trackId);
      final info   = (entry.value as Map?)?.cast<String, dynamic>() ?? {};
      final locked = info['locked'] == true;
      final name   = info['name'] as String? ?? '?';
      final sim    = ((info['sim'] as num?) ?? 0.0).toDouble();

      _trackFirstSeen.putIfAbsent(trackId, () => now);

      if (locked && name != '?' && !_popupShownFor.contains(trackId)) {
        _popupShownFor.add(trackId);
        _showDetectionPopup(name, sim, false);
        // Update stage even if it's the same product name — the name check
        // was the bug that caused "stuck on previous product". We gate on
        // trackId via _popupShownFor instead.
        if (name != _lastLockedLabel) {
          _lastLockedLabel = name;
          setState(() {
            _product = Product.fromServer(name);
            _scan    = _ScanState.recognized;
            _conf    = sim * 100;
            _added   = true;
          });
          _heroCtrl.forward(from: 0);
          _confCtrl.forward(from: 0);
        }
      }

      if (!locked && !_popupShownFor.contains(trackId)) {
        final elapsed = now.difference(_trackFirstSeen[trackId]!);
        if (elapsed.inSeconds >= 5) {
          _popupShownFor.add(trackId);
          _showDetectionPopup('?', 0.0, true);
        }
      }
    }

    _trackFirstSeen.removeWhere((id, _) => !activeIds.contains(id));
    // Allow re-showing popup if a stable_id is later reused for a new product
    _popupShownFor.removeWhere((id) => !activeIds.contains(id));

    // Fix: when all products leave the frame, reset the stage so the next
    // product — even with the same name — can re-trigger the hero card.
    if (activeIds.isEmpty && _scan == _ScanState.recognized) {
      setState(() {
        _scan            = _ScanState.scanning;
        _lastLockedLabel = null;
        _product         = null;
        _conf            = 0;
        _added           = false;
      });
    }
  }

  void _showDetectionPopup(String label, double sim, bool isUnknown) {
    HapticFeedback.mediumImpact();
    _popupTimer?.cancel();
    setState(() => _detectionEvent = _DetectionEvent(
      label:     label,
      sim:       sim,
      isUnknown: isUnknown,
    ));
    _popupTimer = Timer(const Duration(seconds: 5), () {
      if (mounted) setState(() => _detectionEvent = null);
    });
  }

  Future<void> _callServerReset() async {
    try {
      var base = widget.serverUrl.trim();
      while (base.endsWith('/')) { base = base.substring(0, base.length - 1); }
      final req = await HttpClient().postUrl(Uri.parse('$base/reset'));
      await (await req.close()).drain<dynamic>();
    } catch (_) {}
  }

  void _toast(String msg, _ToastKind kind) {
    final id = '${DateTime.now().microsecondsSinceEpoch}';
    setState(() => _toasts.add(_Toast(id, msg, kind)));
    _timers.add(Timer(const Duration(milliseconds: 2600), () {
      if (mounted) setState(() => _toasts.removeWhere((t) => t.id == id));
    }));
  }

  void _addToReceipt(Product product, int? vi) {
    final variant = product.variantValue(vi);
    final unit    = product.priceForVariant(vi);
    setState(() {
      final idx = _receipt.indexWhere(
        (l) => l.pid == product.id && l.variant == variant,
      );
      if (idx >= 0) {
        _receipt[idx] = _receipt[idx].copyWith(
          qty:       _receipt[idx].qty + 1,
          justAdded: true,
        );
      } else {
        _receipt.add(ReceiptLine(
          key:     '${product.id}${variant ?? ''}${Random().nextInt(9999)}',
          pid:     product.id,
          product: product,
          variant: variant,
          unit:    unit,
          qty:     1,
          justAdded: true,
        ));
      }
    });
    _timers.add(Timer(const Duration(milliseconds: 1200), () {
      if (mounted) {
        setState(() {
          for (var i = 0; i < _receipt.length; i++) {
            if (_receipt[i].justAdded) {
              _receipt[i] = _receipt[i].copyWith(justAdded: false);
            }
          }
        });
      }
    }));
  }

  void _pickVariant(int vi) {
    if (_product == null) return;
    final oldVi = _vi;
    setState(() => _vi = vi);
    if (_added) {
      final p      = _product!;
      final oldVar = p.variantValue(oldVi);
      final newVar = p.variantValue(vi);
      final newUnit = p.priceForVariant(vi);
      setState(() {
        final idx = _receipt.indexWhere(
          (l) => l.pid == p.id && l.variant == oldVar,
        );
        if (idx >= 0) {
          _receipt[idx] = _receipt[idx].copyWith(
            variant: newVar,
            unit:    newUnit,
          );
        }
      });
    }
  }

  void _changeQty(String key, int delta) {
    final idx = _receipt.indexWhere((l) => l.key == key);
    if (idx < 0) return;
    final pid    = _receipt[idx].pid;
    final newQty = _receipt[idx].qty + delta;
    _userEditedPids.add(pid);
    if (newQty <= 0) {
      setState(() => _receipt.removeAt(idx));
    } else {
      setState(() => _receipt[idx] = _receipt[idx].copyWith(qty: newQty));
    }
  }

  void _removeLine(String key) {
    final idx = _receipt.indexWhere((l) => l.key == key);
    if (idx >= 0) _userEditedPids.add(_receipt[idx].pid);
    setState(() => _receipt.removeWhere((l) => l.key == key));
  }

  void _clearBasket() {
    for (final l in _receipt) { _userEditedPids.add(l.pid); }
    setState(() {
      _receipt.clear();
      _popupShownFor.clear();
      _trackFirstSeen.clear();
      _detectionEvent = null;
    });
    _popupTimer?.cancel();
    _callServerReset();
    _toast('Basket cleared', _ToastKind.warn);
  }

  void _checkout() {
    if (_receipt.isEmpty) return;
    _toast("Receipt sent — you're good to go!", _ToastKind.ok);
    for (final l in _receipt) { _userEditedPids.add(l.pid); }
    _callServerReset();
    _popupTimer?.cancel();
    _timers.add(Timer(const Duration(milliseconds: 900), () {
      if (mounted) {
        setState(() {
          _receipt.clear();
          _product         = null;
          _lastLockedLabel = null;
          _scan            = _ScanState.scanning;
          _added           = false;
          _conf            = 0;
          _popupShownFor.clear();
          _trackFirstSeen.clear();
          _detectionEvent  = null;
        });
      }
    }));
  }

  int get _itemCount => _receipt.fold(0, (a, l) => a + l.qty);
  int get _subtotal  => _receipt.fold(0, (a, l) => a + l.total);
  int get _vat       => (_subtotal - _subtotal / 1.09).round();

  String _fmtNum(int n) => n.toString().replaceAllMapped(
    RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
    (m) => '${m[1]} ',
  );

  String get _timeStr {
    final h = _now.hour.toString().padLeft(2, '0');
    final m = _now.minute.toString().padLeft(2, '0');
    final s = _now.second.toString().padLeft(2, '0');
    return '$h:$m:$s';
  }

  String get _dateStr {
    const days   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun',
                    'Jul','Aug','Sep','Oct','Nov','Dec'];
    return '${days[_now.weekday - 1]}, ${_now.day} ${months[_now.month - 1]}';
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  BUILD
  // ══════════════════════════════════════════════════════════════════════════

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Stack(
          children: [
            Column(
              children: [
                _topBar(),
                _cameraStrip(),
                Expanded(
                  child: SingleChildScrollView(
                    physics: const ClampingScrollPhysics(),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _stageBody(),
                        _scanFooter(),
                        _receiptPanel(),
                        const SizedBox(height: 12),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            _toastLayer(),
            _detectionPopupLayer(),
          ],
        ),
      ),
    );
  }

  // ═══════════════════════ TOP BAR ══════════════════════════════════════════
  Widget _topBar() {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 10, 12, 0),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.lineSoft),
        boxShadow: [
          BoxShadow(
            color: AppColors.ink.withAlpha(13),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 38, height: 38,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [AppColors.skySoft, AppColors.white],
              ),
              borderRadius: BorderRadius.circular(11),
              border: Border.all(color: AppColors.line),
            ),
            child: const Icon(Icons.shopping_basket_rounded,
                color: AppColors.sky, size: 20),
          ),
          const SizedBox(width: 9),
          const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Smart Basket',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 14.5,
                    color: AppColors.ink,
                    letterSpacing: -0.3,
                  )),
              Text('Lane tablet',
                  style: TextStyle(
                    fontSize: 9.5,
                    color: AppColors.ink3,
                    letterSpacing: 0.5,
                  )),
            ],
          ),
          Container(
            width: 1, height: 26,
            color: AppColors.line,
            margin: const EdgeInsets.symmetric(horizontal: 10),
          ),
          const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('LANE',
                  style: TextStyle(
                    fontSize: 8.5,
                    color: AppColors.ink4,
                    letterSpacing: 0.8,
                  )),
              Text('03 · Self-scan',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 12,
                    color: AppColors.ink,
                  )),
            ],
          ),
          const SizedBox(width: 8),
          _livePill(),
          const Spacer(),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_timeStr,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                    color: AppColors.ink,
                    fontFamily: 'monospace',
                  )),
              Text(_dateStr,
                  style: const TextStyle(fontSize: 9.5, color: AppColors.ink3)),
            ],
          ),
          const SizedBox(width: 10),
          GestureDetector(
            onTap: () => showDialog(
              context: context,
              builder: (ctx) => AlertDialog(
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16)),
                title: const Text('Server connection'),
                content: Text(widget.serverUrl,
                    style: const TextStyle(
                        fontSize: 12,
                        fontFamily: 'monospace',
                        color: AppColors.ink3)),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(ctx),
                    child: const Text('Cancel'),
                  ),
                  TextButton(
                    onPressed: () {
                      Navigator.pop(ctx);
                      _disconnectAndGoBack();
                    },
                    child: const Text('Change server',
                        style: TextStyle(color: AppColors.red)),
                  ),
                ],
              ),
            ),
            child: Container(
              width: 34, height: 34,
              decoration: BoxDecoration(
                color: AppColors.skySoft,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.line),
              ),
              child: const Icon(Icons.wifi_rounded,
                  size: 17, color: AppColors.skyDeep),
            ),
          ),
        ],
      ),
    );
  }

  Widget _livePill() {
    return AnimatedBuilder(
      animation: _liveDotCtrl,
      builder: (context, _) {
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
          decoration: BoxDecoration(
            color: AppColors.greenSoft,
            borderRadius: BorderRadius.circular(99),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 7, height: 7,
                decoration: BoxDecoration(
                  color: AppColors.green,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.green.withAlpha(
                          (120 * (1 - _liveDotCtrl.value)).round()),
                      blurRadius: 8 * _liveDotCtrl.value,
                      spreadRadius: 1,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 5),
              const Text('Live',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF1D8B53),
                  )),
            ],
          ),
        );
      },
    );
  }

  // ═══════════════════════ CAMERA STRIP ═════════════════════════════════════
  Widget _cameraStrip() {
    final isScanning   = _scan == _ScanState.scanning;
    final isRecognized = _scan == _ScanState.recognized;
    final reticleColor = isRecognized
        ? AppColors.green
        : isScanning
            ? AppColors.peach
            : AppColors.sky;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
          child: SizedBox(
            height: _cameraHeight,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(20),
                gradient: const LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Color(0xFF31506B), Color(0xFF1C2D3C)],
                ),
                border: Border.all(color: const Color(0xFF1A2733)),
              ),
              clipBehavior: Clip.hardEdge,
              child: Stack(
                children: [
                  if (_serverFrame != null)
                    Positioned.fill(
                      child: Image.memory(
                        _serverFrame!,
                        fit: BoxFit.cover,
                        gaplessPlayback: true,
                      ),
                    )
                  else
                    Positioned.fill(
                        child: CustomPaint(painter: _GridPainter())),
                  if (isScanning && _serverFrame == null)
                    AnimatedBuilder(
                      animation: _scanLinePos,
                      builder: (_, _) => Positioned(
                        top: 4 + _scanLinePos.value * (_cameraHeight - 17),
                        left: 0, right: 0,
                        child: Container(
                          height: 2,
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(colors: [
                              Colors.transparent,
                              AppColors.sky,
                              Colors.transparent,
                            ]),
                            boxShadow: [
                              BoxShadow(
                                color: AppColors.sky.withAlpha(128),
                                blurRadius: 14,
                                spreadRadius: 2,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  Center(
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 300),
                      curve: Curves.easeOut,
                      width:  isScanning ? 150 : 112,
                      height: isScanning ? 108 : 84,
                      child: CustomPaint(
                          painter: _ReticlePainter(color: reticleColor)),
                    ),
                  ),
                  Positioned(
                    top: 12, right: 14,
                    child: Row(
                      children: [
                        _camTag(_streaming ? 'LIVE ▸ AI' : 'OFFLINE'),
                        const SizedBox(width: 6),
                        if (_wsError != null) _camTag('ERR'),
                      ],
                    ),
                  ),
                  Positioned(
                    bottom: 12, left: 16,
                    child: Row(
                      children: [
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          width: 7, height: 7,
                          decoration: BoxDecoration(
                            color: reticleColor,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          _streaming
                              ? (isRecognized
                                  ? 'Recognized · ${_product?.name}'
                                  : 'Scanning live · AI processing…')
                              : (_wsError != null
                                  ? 'Reconnecting…'
                                  : 'Connecting to server…'),
                          style: const TextStyle(
                            color: Color(0xFFCFE2F2),
                            fontSize: 11.5,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        GestureDetector(
          onVerticalDragUpdate: (d) {
            setState(() {
              _cameraHeight =
                  (_cameraHeight + d.delta.dy).clamp(_cameraMinH, _cameraMaxH);
            });
          },
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 12),
            height: 22,
            color: Colors.transparent,
            child: Center(
              child: Container(
                width: 44, height: 4,
                decoration: BoxDecoration(
                  color: AppColors.line,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _camTag(String text) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        decoration: BoxDecoration(
          color: const Color(0x800D161F),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: AppColors.sky.withAlpha(51)),
        ),
        child: Text(text,
            style: const TextStyle(
              fontSize: 8.5,
              color: Color(0xFF9FB8CC),
              letterSpacing: 0.4,
              fontFamily: 'monospace',
            )),
      );

  // ═══════════════════════ STAGE BODY ═══════════════════════════════════════
  Widget _stageBody() {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 10, 12, 0),
      constraints: const BoxConstraints(minHeight: 220),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(20),
          bottom: Radius.circular(4),
        ),
        border: Border.all(color: AppColors.lineSoft),
        boxShadow: [
          BoxShadow(
            color: AppColors.ink.withAlpha(15),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      clipBehavior: Clip.hardEdge,
      child: _scan != _ScanState.recognized || _product == null
          ? _idleState()
          : _productHero(),
    );
  }

  Widget _idleState() {
    final isScanning = _scan == _ScanState.scanning;
    return Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          AnimatedBuilder(
            animation: _floatOffset,
            builder: (_, child) => Transform.translate(
              offset: Offset(0, isScanning ? 0 : _floatOffset.value),
              child: child,
            ),
            child: Container(
              width: 80, height: 80,
              decoration: BoxDecoration(
                color: AppColors.skySoft,
                borderRadius: BorderRadius.circular(24),
              ),
              child: Icon(
                isScanning
                    ? Icons.document_scanner_rounded
                    : Icons.shopping_basket_rounded,
                color: AppColors.skyDeep,
                size: 38,
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            isScanning ? 'Reading the item…' : 'Place an item in the basket',
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
              letterSpacing: -0.4,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            isScanning
                ? 'Hold steady — the cameras are identifying the product and its variant.'
                : 'Drop a product into your smart basket and it appears here instantly.',
            style: const TextStyle(
              fontSize: 13,
              color: AppColors.ink3,
              height: 1.55,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _productHero() {
    final p = _product!;
    return SlideTransition(
      position: _heroSlide,
      child: FadeTransition(
        opacity: _heroBrightness,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Stack(
                    children: [
                      Container(
                        width: 120, height: 120,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(16),
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [p.tileGradientStart, p.tileGradientEnd],
                          ),
                          border: Border.all(color: AppColors.line),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Container(
                              width: 54, height: 54,
                              decoration: BoxDecoration(
                                color: p.tileGradientStart.withAlpha(200),
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(
                                    color: p.tileBorderColor.withAlpha(102)),
                              ),
                              child: Center(
                                child: Text(p.initials,
                                    style: TextStyle(
                                      fontWeight: FontWeight.w700,
                                      fontSize: 20,
                                      color: p.tileTextColor,
                                      fontFamily: 'monospace',
                                    )),
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(p.brand,
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 10,
                                  color: AppColors.ink.withAlpha(178),
                                )),
                          ],
                        ),
                      ),
                      Positioned(
                        top: 8, left: 8,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 4),
                          decoration: BoxDecoration(
                            color: AppColors.green,
                            borderRadius: BorderRadius.circular(99),
                            boxShadow: [
                              BoxShadow(
                                color: AppColors.green.withAlpha(89),
                                blurRadius: 10,
                              ),
                            ],
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.bolt_rounded,
                                  color: Colors.white, size: 11),
                              SizedBox(width: 3),
                              Text('OK',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w800,
                                    fontSize: 9,
                                  )),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 9, vertical: 4),
                          decoration: BoxDecoration(
                            color: AppColors.skySoft,
                            borderRadius: BorderRadius.circular(99),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 5, height: 5,
                                decoration: const BoxDecoration(
                                  color: AppColors.skyDeep,
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 5),
                              Text(p.category,
                                  style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: Color(0xFF2A6DA6),
                                  )),
                            ],
                          ),
                        ),
                        const SizedBox(height: 7),
                        Text(p.name,
                            style: const TextStyle(
                              fontSize: 21,
                              fontWeight: FontWeight.w700,
                              color: AppColors.ink,
                              letterSpacing: -0.5,
                              height: 1.1,
                            )),
                        const SizedBox(height: 3),
                        RichText(
                          text: TextSpan(
                            style: const TextStyle(
                                fontSize: 12, color: AppColors.ink3),
                            children: [
                              const TextSpan(text: 'by '),
                              TextSpan(
                                text: p.brand,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.ink2,
                                ),
                              ),
                              TextSpan(text: ' · ${p.unit}'),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.baseline,
                          textBaseline: TextBaseline.alphabetic,
                          children: [
                            Text(_fmtNum(p.priceForVariant(_vi)),
                                style: const TextStyle(
                                  fontSize: 34,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.ink,
                                  letterSpacing: -1,
                                  fontFamily: 'monospace',
                                )),
                            const SizedBox(width: 4),
                            const Text(kCurrency,
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.ink3,
                                )),
                            const SizedBox(width: 8),
                            const Text('/ unit',
                                style: TextStyle(
                                    fontSize: 11, color: AppColors.ink3)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (p.variants != null) ...[
                const SizedBox(height: 16),
                Text(
                  'Detected ${p.variants!.type.toLowerCase()} — tap to correct',
                  style: const TextStyle(
                    fontSize: 9.5,
                    color: AppColors.ink4,
                    letterSpacing: 0.8,
                    fontFamily: 'monospace',
                  ),
                ),
                const SizedBox(height: 7),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: p.variants!.options.asMap().entries.map((e) {
                      final i   = e.key;
                      final o   = e.value;
                      final sel = i == _vi;
                      return GestureDetector(
                        onTap: () => _pickVariant(i),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 140),
                          margin: const EdgeInsets.only(right: 8),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: sel ? AppColors.skySoft : AppColors.white,
                            borderRadius: BorderRadius.circular(11),
                            border: Border.all(
                              color: sel ? AppColors.sky : AppColors.line,
                              width: 1.5,
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.sell_rounded,
                                  size: 12,
                                  color: sel
                                      ? AppColors.skyDeep
                                      : AppColors.ink3),
                              const SizedBox(width: 5),
                              Text(o.value,
                                  style: TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: sel
                                        ? FontWeight.w600
                                        : FontWeight.w500,
                                    color: sel
                                        ? const Color(0xFF2A6DA6)
                                        : AppColors.ink2,
                                  )),
                              if (o.delta != 0) ...[
                                const SizedBox(width: 5),
                                Text(
                                  '${o.delta > 0 ? "+" : "−"}${_fmtNum(o.delta.abs())}',
                                  style: const TextStyle(
                                    fontSize: 11,
                                    color: AppColors.ink3,
                                    fontFamily: 'monospace',
                                  ),
                                ),
                              ],
                              if (sel) ...[
                                const SizedBox(width: 4),
                                const Icon(Icons.check_rounded,
                                    size: 13, color: AppColors.skyDeep),
                              ],
                            ],
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ],
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(99),
                      child: Container(
                        height: 7,
                        color: AppColors.line,
                        child: AnimatedBuilder(
                          animation: _confCtrl,
                          builder: (_, _) => FractionallySizedBox(
                            widthFactor: (_conf / 100) * _confCtrl.value,
                            alignment: Alignment.centerLeft,
                            child: Container(
                              decoration: const BoxDecoration(
                                gradient: LinearGradient(
                                  colors: [AppColors.sky, AppColors.green],
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    _conf > 0 ? '${_conf.toStringAsFixed(1)}%' : '—',
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                      color: AppColors.ink,
                      fontFamily: 'monospace',
                    ),
                  ),
                  const SizedBox(width: 4),
                  const Text('match',
                      style: TextStyle(fontSize: 10.5, color: AppColors.ink3)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ═══════════════════════ SCAN FOOTER ══════════════════════════════════════
  Widget _scanFooter() {
    final p = _product;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 2, 12, 0),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius:
            const BorderRadius.vertical(bottom: Radius.circular(20)),
        border: const Border(
          left:   BorderSide(color: AppColors.lineSoft),
          right:  BorderSide(color: AppColors.lineSoft),
          bottom: BorderSide(color: AppColors.lineSoft),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.ink.withAlpha(10),
            blurRadius: 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          if (_scan == _ScanState.recognized && p != null) ...[
            _added
                ? Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 11),
                    decoration: BoxDecoration(
                      color: AppColors.greenSoft,
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.check_rounded,
                            color: Color(0xFF1D8B53), size: 16),
                        SizedBox(width: 6),
                        Text('Added',
                            style: TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 13.5,
                              color: Color(0xFF1D8B53),
                            )),
                      ],
                    ),
                  )
                : _btn(
                    label: 'Add',
                    icon: Icons.add_rounded,
                    color: AppColors.peach,
                    onTap: () {
                      setState(() => _added = true);
                      _addToReceipt(p, _vi);
                      _toast('${p.name} added', _ToastKind.ok);
                    },
                  ),
            const SizedBox(width: 8),
          ],
          Expanded(
            child: _streaming
                ? _btn(
                    label: 'Scanning live…',
                    icon: Icons.sensors_rounded,
                    color: AppColors.green,
                    onTap: null,
                    full: true,
                  )
                : _btn(
                    label: _wsError != null
                        ? 'Reconnecting…'
                        : 'Connecting…',
                    icon: Icons.wifi_off_rounded,
                    color: AppColors.sky,
                    onTap: null,
                    full: true,
                  ),
          ),
        ],
      ),
    );
  }

  Widget _btn({
    required String label,
    required IconData icon,
    required Color color,
    VoidCallback? onTap,
    bool full = false,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 150),
        opacity: onTap == null ? 0.5 : 1.0,
        child: Container(
          height: 46,
          padding: EdgeInsets.symmetric(horizontal: full ? 0 : 16),
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(13),
            boxShadow: onTap != null
                ? [
                    BoxShadow(
                      color: color.withAlpha(102),
                      blurRadius: 14,
                      offset: const Offset(0, 6),
                    ),
                  ]
                : null,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: full ? MainAxisSize.max : MainAxisSize.min,
            children: [
              Icon(icon, color: Colors.white, size: 17),
              const SizedBox(width: 7),
              Text(label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  )),
            ],
          ),
        ),
      ),
    );
  }

  // ═══════════════════════ RECEIPT PANEL ════════════════════════════════════
  Widget _receiptPanel() {
    final sub = _subtotal;
    final ic  = _itemCount;
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 0),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.lineSoft),
        boxShadow: [
          BoxShadow(
            color: AppColors.ink.withAlpha(15),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
            child: Row(
              children: [
                const Icon(Icons.receipt_long_rounded,
                    color: AppColors.ink2, size: 18),
                const SizedBox(width: 8),
                const Text('Draft receipt',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                      letterSpacing: -0.3,
                    )),
                const SizedBox(width: 7),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.sky,
                    borderRadius: BorderRadius.circular(99),
                  ),
                  child: Text('$ic',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      )),
                ),
                const Spacer(),
                const Text('BASKET #A-2291 · LANE 03',
                    style: TextStyle(
                      fontSize: 9.5,
                      color: AppColors.ink3,
                      fontFamily: 'monospace',
                    )),
              ],
            ),
          ),
          const Divider(height: 1, color: AppColors.line),
          _receipt.isEmpty
              ? Padding(
                  padding: const EdgeInsets.symmetric(vertical: 28),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 48, height: 48,
                        decoration: BoxDecoration(
                          color: AppColors.skySoft,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: const Icon(Icons.shopping_basket_rounded,
                            color: AppColors.skyDeep, size: 26),
                      ),
                      const SizedBox(height: 10),
                      const Text('Your basket is empty',
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: AppColors.ink2,
                            fontSize: 13,
                          )),
                      const SizedBox(height: 3),
                      const Text('Scanned items will appear here.',
                          style: TextStyle(
                              fontSize: 12, color: AppColors.ink4)),
                    ],
                  ),
                )
              : ListView.separated(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 4),
                  itemCount: _receipt.length,
                  separatorBuilder: (_, _) =>
                      const Divider(height: 1, color: AppColors.lineSoft),
                  itemBuilder: (_, i) => _receiptLine(_receipt[i]),
                ),
          Container(
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [AppColors.white, AppColors.skySoft2],
              ),
              border: Border(
                  top: BorderSide(color: AppColors.line.withAlpha(160))),
              borderRadius:
                  const BorderRadius.vertical(bottom: Radius.circular(20)),
            ),
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
            child: Column(
              children: [
                _totRow('Items', '$ic'),
                const SizedBox(height: 4),
                _totRow('Subtotal', '${_fmtNum(sub)} $kCurrency'),
                const SizedBox(height: 4),
                _totRow('VAT (9%) incl.', '${_fmtNum(_vat)} $kCurrency'),
                const SizedBox(height: 12),
                const Divider(height: 1, color: AppColors.line),
                const SizedBox(height: 10),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    const Text('Total',
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        )),
                    const Spacer(),
                    Text(_fmtNum(sub),
                        style: const TextStyle(
                          fontSize: 28,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                          letterSpacing: -0.8,
                          fontFamily: 'monospace',
                        )),
                    const SizedBox(width: 4),
                    const Text(kCurrency,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink3,
                        )),
                  ],
                ),
                const SizedBox(height: 12),
                GestureDetector(
                  onTap: _receipt.isEmpty ? null : _checkout,
                  child: AnimatedOpacity(
                    duration: const Duration(milliseconds: 150),
                    opacity: _receipt.isEmpty ? 0.45 : 1.0,
                    child: Container(
                      width: double.infinity,
                      height: 52,
                      decoration: BoxDecoration(
                        color: AppColors.sky,
                        borderRadius: BorderRadius.circular(14),
                        boxShadow: _receipt.isNotEmpty
                            ? [
                                BoxShadow(
                                  color: AppColors.sky.withAlpha(102),
                                  blurRadius: 16,
                                  offset: const Offset(0, 6),
                                ),
                              ]
                            : null,
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.credit_card_rounded,
                              color: Colors.white, size: 18),
                          const SizedBox(width: 8),
                          Text(
                            'Checkout · $ic item${ic == 1 ? "" : "s"}',
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w600,
                              fontSize: 15,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: _ghostBtn(
                        label: 'Clear',
                        icon: Icons.delete_outline_rounded,
                        onTap: _receipt.isEmpty ? null : _clearBasket,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _ghostBtn(
                        label: 'Send to phone',
                        icon: Icons.phone_android_rounded,
                        onTap: _receipt.isEmpty
                            ? null
                            : () => _toast(
                                'Receipt sent to your phone',
                                _ToastKind.info,
                              ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _receiptLine(ReceiptLine l) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      color: l.justAdded ? AppColors.greenSoft : Colors.transparent,
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
      child: Row(
        children: [
          Container(
            width: 48, height: 48,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(11),
              border: Border.all(color: AppColors.line),
              gradient: LinearGradient(
                colors: [l.product.tileGradientStart, l.product.tileGradientEnd],
              ),
            ),
            child: Center(
              child: Text(l.product.initials,
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                    color: l.product.tileTextColor,
                    fontFamily: 'monospace',
                  )),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l.product.name,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 12.5,
                      color: AppColors.ink,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
                if (l.variant != null)
                  Text('${l.product.variants!.type}: ${l.variant}',
                      style:
                          const TextStyle(fontSize: 11, color: AppColors.ink3)),
                Text('${_fmtNum(l.unit)} $kCurrency / unit',
                    style: const TextStyle(
                      fontSize: 10.5,
                      color: AppColors.ink4,
                      fontFamily: 'monospace',
                    )),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('${_fmtNum(l.total)} $kCurrency',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 13.5,
                    color: AppColors.ink,
                    fontFamily: 'monospace',
                  )),
              const SizedBox(height: 6),
              _qtyControl(l),
            ],
          ),
        ],
      ),
    );
  }

  Widget _qtyControl(ReceiptLine l) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.skySoft2,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          GestureDetector(
            onTap: () =>
                l.qty == 1 ? _removeLine(l.key) : _changeQty(l.key, -1),
            child: SizedBox(
              width: 28, height: 28,
              child: Icon(
                l.qty == 1
                    ? Icons.delete_outline_rounded
                    : Icons.remove_rounded,
                size: 14,
                color: l.qty == 1 ? AppColors.red : AppColors.ink2,
              ),
            ),
          ),
          SizedBox(
            width: 24,
            child: Text('${l.qty}',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                  color: AppColors.ink,
                  fontFamily: 'monospace',
                )),
          ),
          GestureDetector(
            onTap: () => _changeQty(l.key, 1),
            child: const SizedBox(
              width: 28, height: 28,
              child: Icon(Icons.add_rounded, size: 14, color: AppColors.ink2),
            ),
          ),
        ],
      ),
    );
  }

  Widget _totRow(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 1),
        child: Row(
          children: [
            Text(label,
                style: const TextStyle(fontSize: 13, color: AppColors.ink2)),
            const Spacer(),
            Text(value,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: AppColors.ink,
                  fontFamily: 'monospace',
                )),
          ],
        ),
      );

  Widget _ghostBtn({
    required String label,
    required IconData icon,
    VoidCallback? onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 150),
        opacity: onTap == null ? 0.45 : 1.0,
        child: Container(
          height: 40,
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(11),
            border: Border.all(color: AppColors.line),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 15, color: AppColors.ink2),
              const SizedBox(width: 5),
              Text(label,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink2,
                  )),
            ],
          ),
        ),
      ),
    );
  }

  // ═══════════════════════ DETECTION POPUP ══════════════════════════════════
  Widget _detectionPopupLayer() {
    return Positioned(
      top: 12, left: 16, right: 16,
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 380),
        transitionBuilder: (child, anim) => SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0, -1.4),
            end: Offset.zero,
          ).animate(
              CurvedAnimation(parent: anim, curve: Curves.easeOutBack)),
          child: FadeTransition(opacity: anim, child: child),
        ),
        child: _detectionEvent == null
            ? const SizedBox.shrink()
            : _popupCard(_detectionEvent!),
      ),
    );
  }

  Widget _popupCard(_DetectionEvent event) {
    final isUnknown = event.isUnknown;
    final accent    = isUnknown ? AppColors.red   : AppColors.green;
    final bg        = isUnknown
        ? const Color(0xFFFFF0EE)
        : AppColors.greenSoft;
    final icon      = isUnknown
        ? Icons.help_outline_rounded
        : Icons.check_circle_rounded;
    final titleText = isUnknown ? 'Unknown product' : 'Product detected';
    final bodyText  = isUnknown
        ? 'Could not identify this item'
        : event.label;
    return Material(
      key: ValueKey(event.label + event.isUnknown.toString()),
      elevation: 10,
      shadowColor: accent.withAlpha(60),
      borderRadius: BorderRadius.circular(18),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: accent.withAlpha(80)),
        ),
        child: Row(
          children: [
            Container(
              width: 46, height: 46,
              decoration: BoxDecoration(
                color: accent,
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(icon, color: Colors.white, size: 26),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(titleText,
                      style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w700,
                        color: accent,
                        letterSpacing: 0.6,
                      )),
                  const SizedBox(height: 2),
                  Text(bodyText,
                      style: TextStyle(
                        fontSize: 15.5,
                        fontWeight: FontWeight.w700,
                        color: isUnknown ? AppColors.red : AppColors.ink,
                        letterSpacing: -0.3,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
                  if (!isUnknown && event.sim > 0)
                    Text(
                      '${(event.sim * 100).toStringAsFixed(1)}% confidence',
                      style: const TextStyle(
                          fontSize: 11.5, color: AppColors.ink3),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 28, height: 28,
              child: TweenAnimationBuilder<double>(
                key: ValueKey(event.label + event.isUnknown.toString()),
                tween: Tween(begin: 1.0, end: 0.0),
                duration: const Duration(seconds: 5),
                builder: (context, v, child) => CircularProgressIndicator(
                  value: v,
                  strokeWidth: 2.5,
                  color: accent,
                  backgroundColor: accent.withAlpha(40),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ═══════════════════════ TOASTS ═══════════════════════════════════════════
  Widget _toastLayer() {
    if (_toasts.isEmpty) return const SizedBox.shrink();
    return Positioned(
      bottom: 16, left: 16, right: 16,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: _toasts.map(_toastWidget).toList(),
      ),
    );
  }

  Widget _toastWidget(_Toast t) {
    final Color iconBg;
    final IconData icon;
    switch (t.kind) {
      case _ToastKind.ok:
        iconBg = AppColors.green;
        icon   = Icons.check_rounded;
      case _ToastKind.info:
        iconBg = AppColors.sky;
        icon   = Icons.phone_android_rounded;
      case _ToastKind.warn:
        iconBg = AppColors.peach;
        icon   = Icons.delete_outline_rounded;
    }
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.ink,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: AppColors.ink.withAlpha(77),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 24, height: 24,
            decoration: BoxDecoration(color: iconBg, shape: BoxShape.circle),
            child: Icon(icon, color: Colors.white, size: 14),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(t.message,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13.5,
                  fontWeight: FontWeight.w500,
                )),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════ PAINTERS ═════════════════════════════════════════

class _GridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFF7CB9E8).withAlpha(20)
      ..strokeWidth = 1;
    const step = 28.0;
    for (double x = 0; x <= size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (double y = 0; y <= size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(_GridPainter _) => false;
}

class _ReticlePainter extends CustomPainter {
  final Color color;
  _ReticlePainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color      = color
      ..strokeWidth = 2.5
      ..style      = PaintingStyle.stroke
      ..strokeCap  = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    const arm = 24.0;
    const r   = 6.0;
    final w   = size.width;
    final h   = size.height;
    // top-left
    canvas.drawPath(Path()
      ..moveTo(0, arm)..lineTo(0, r)
      ..arcToPoint(Offset(r, 0),
          radius: const Radius.circular(r), clockwise: true)
      ..lineTo(arm, 0), paint);
    // top-right
    canvas.drawPath(Path()
      ..moveTo(w - arm, 0)..lineTo(w - r, 0)
      ..arcToPoint(Offset(w, r),
          radius: const Radius.circular(r), clockwise: true)
      ..lineTo(w, arm), paint);
    // bottom-left
    canvas.drawPath(Path()
      ..moveTo(0, h - arm)..lineTo(0, h - r)
      ..arcToPoint(Offset(r, h),
          radius: const Radius.circular(r), clockwise: false)
      ..lineTo(arm, h), paint);
    // bottom-right
    canvas.drawPath(Path()
      ..moveTo(w - arm, h)..lineTo(w - r, h)
      ..arcToPoint(Offset(w, h - r),
          radius: const Radius.circular(r), clockwise: false)
      ..lineTo(w, h - arm), paint);
  }

  @override
  bool shouldRepaint(_ReticlePainter old) => old.color != color;
}
