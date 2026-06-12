import 'package:flutter/material.dart';

class VariantOption {
  final String value;
  final int delta;
  const VariantOption({required this.value, required this.delta});
}

class ProductVariants {
  final String type;
  final List<VariantOption> options;
  final int detected;
  const ProductVariants({
    required this.type,
    required this.options,
    required this.detected,
  });
}

class Product {
  final String id;
  final String name;
  final String brand;
  final String category;
  final int price;
  final String unit;
  final int hue;
  final ProductVariants? variants;

  const Product({
    required this.id,
    required this.name,
    required this.brand,
    required this.category,
    required this.price,
    required this.unit,
    required this.hue,
    this.variants,
  });

  int priceForVariant(int? vi) {
    if (variants == null || vi == null) return price;
    return price + variants!.options[vi].delta;
  }

  String? variantValue(int? vi) {
    if (variants == null || vi == null) return null;
    return variants!.options[vi].value;
  }

  String get initials =>
      name.split(' ').take(2).map((w) => w.isNotEmpty ? w[0] : '').join();

  Color get tileGradientStart =>
      HSLColor.fromAHSL(1, hue.toDouble(), 0.6, 0.92).toColor();

  Color get tileGradientEnd =>
      HSLColor.fromAHSL(1, ((hue + 30) % 360).toDouble(), 0.55, 0.84).toColor();

  Color get tileTextColor =>
      HSLColor.fromAHSL(1, hue.toDouble(), 0.45, 0.38).toColor();

  Color get tileBorderColor =>
      HSLColor.fromAHSL(1, hue.toDouble(), 0.45, 0.74).toColor();

  factory Product.fromServer(String label) {
    final hue = label.codeUnits.fold<int>(0, (a, b) => (a * 31 + b) % 360);
    return Product(
      id: label,
      name: label,
      brand: '',
      category: 'Scanned',
      price: 0,
      unit: 'item',
      hue: hue,
    );
  }
}
