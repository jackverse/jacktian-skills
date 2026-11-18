import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;

/**
 * Generic JDBC ad-hoc query runner for chart/data root-cause checks.
 * Works with any DB whose JDBC 4+ driver jar is on the -cp (DM/MySQL/PG/Oracle ojdbc8+...,
 * drivers self-register via ServiceLoader, no Class.forName needed).
 *
 * Usage:
 *   java JdbcAdhocQuery <jdbcUrl> <user> <password> <sql | @query.sql> [maxRows]
 *
 * Output: TSV with a header line; last line "-- N row(s)".
 * Long/multi-line SQL: save to a UTF-8 file and pass @file.sql to avoid shell quoting pain.
 */
public class JdbcAdhocQuery {
    public static void main(String[] args) throws Exception {
        if (args.length < 4) {
            System.err.println("usage: java JdbcAdhocQuery <jdbcUrl> <user> <pass> <sql|@file.sql> [maxRows=1000]");
            System.exit(2);
        }
        String url = args[0];
        String user = args[1];
        String pass = args[2];
        String sqlSpec = args[3];
        int maxRows = args.length > 4 ? Integer.parseInt(args[4]) : 1000;
        String sql = sqlSpec.startsWith("@")
                ? new String(Files.readAllBytes(Paths.get(sqlSpec.substring(1))), StandardCharsets.UTF_8)
                : sqlSpec;
        try (Connection conn = DriverManager.getConnection(url, user, pass);
             Statement st = conn.createStatement()) {
            boolean hasRs = st.execute(sql);
            if (!hasRs) {
                System.out.println("-- update count: " + st.getUpdateCount());
                return;
            }
            try (ResultSet rs = st.getResultSet()) {
                ResultSetMetaData md = rs.getMetaData();
                int n = md.getColumnCount();
                StringBuilder head = new StringBuilder();
                for (int i = 1; i <= n; i++) {
                    if (i > 1) head.append('\t');
                    head.append(md.getColumnLabel(i));
                }
                System.out.println(head);
                int rows = 0;
                while (rows < maxRows && rs.next()) {
                    StringBuilder sb = new StringBuilder();
                    for (int i = 1; i <= n; i++) {
                        if (i > 1) sb.append('\t');
                        String v = rs.getString(i);
                        sb.append(v == null ? "\\N" : v.replace('\t', ' ').replace('\n', ' ').replace('\r', ' '));
                    }
                    System.out.println(sb);
                    rows++;
                }
                boolean truncated = rs.next();
                System.out.println("-- " + rows + " row(s)" + (truncated ? " (TRUNCATED at maxRows=" + maxRows + ")" : ""));
            }
        }
    }
}
