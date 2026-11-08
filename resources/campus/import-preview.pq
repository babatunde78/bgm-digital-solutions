(CsvPath as text, TextColumns as list, DateColumns as list, MinorColumns as list) as table =>
let
    Raw = Csv.Document(File.Contents(CsvPath), [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),
    Headers = Table.PromoteHeaders(Raw, [PromoteAllScalars=true]),
    TextOnly = Table.TransformColumnTypes(Headers, List.Transform(Table.ColumnNames(Headers), each {_, type text})),
    Indexed = Table.AddIndexColumn(TextOnly, "source_row", 2, 1, Int64.Type),
    Checked = Table.AddColumn(Indexed, "validation_errors", (record) =>
        let
            Unsafe = List.Select(TextColumns, (column) =>
                let Value = Text.TrimStart(Record.FieldOrDefault(record, column, ""))
                in List.Contains({"=", "+", "-", "@"}, Text.Start(Value, 1))),
            Dates = List.Select(DateColumns, (column) =>
                let Value = Record.FieldOrDefault(record, column, ""),
                    Parsed = try Date.FromText(Value, "en-US")
                in if Parsed[HasError] then true else Date.ToText(Parsed[Value], "yyyy-MM-dd", "en-US") <> Value),
            Amounts = List.Select(MinorColumns, (column) =>
                let Value = Record.FieldOrDefault(record, column, ""), Parsed = try Int64.From(Value)
                in Value = "" or Text.Select(Value, {"0".."9"}) <> Value or Parsed[HasError]),
            Problems = List.Transform(Unsafe, each _ & ": unsafe text") & List.Transform(Dates, each _ & ": use ISO date") & List.Transform(Amounts, each _ & ": use nonnegative integer kobo")
        in Text.Combine(Problems, "; "), type text),
    Timestamped = Table.AddColumn(Checked, "preview_refresh_utc", each DateTimeZone.RemoveZone(DateTimeZone.FixedUtcNow()), type datetime)
in
    Timestamped
