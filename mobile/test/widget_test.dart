import 'package:flutter_test/flutter_test.dart';
import 'package:smart_basket/main.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const SmartBasketApp());
    expect(find.text('Smart Basket'), findsOneWidget);
  });
}
