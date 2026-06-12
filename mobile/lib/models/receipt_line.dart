import 'product.dart';

class ReceiptLine {
  final String key;
  final String pid;
  final Product product;
  final String? variant;
  final int unit;
  final int qty;
  final bool justAdded;

  const ReceiptLine({
    required this.key,
    required this.pid,
    required this.product,
    required this.variant,
    required this.unit,
    required this.qty,
    this.justAdded = false,
  });

  int get total => unit * qty;

  ReceiptLine copyWith({
    int? qty,
    String? variant,
    int? unit,
    bool? justAdded,
  }) =>
      ReceiptLine(
        key: key,
        pid: pid,
        product: product,
        variant: variant ?? this.variant,
        unit: unit ?? this.unit,
        qty: qty ?? this.qty,
        justAdded: justAdded ?? this.justAdded,
      );
}
