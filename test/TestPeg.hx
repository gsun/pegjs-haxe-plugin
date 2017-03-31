class TestPeg {
    function new() {}
    static function main() {
        var peg = new Peg("abbc");
        trace(peg.parse());
    }
}