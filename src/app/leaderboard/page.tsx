import { topFarms } from '../../lib/leaderboard';
import { CoinIcon } from '../../components/Bloom';

export const dynamic = 'force-dynamic';

export default async function Leaderboard() {
  const farms = await topFarms();
  return (
    <>
      <div className="row-head">
        <h1>Richest farms</h1>
      </div>
      <div className="card table-wrap">
        {farms.length ? (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Farmer</th>
                <th>Coins</th>
                <th>Level</th>
                <th>Day</th>
                <th>Animals</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {farms.map((f) => (
                <tr key={f.username}>
                  <td>{f.rank}</td>
                  <td>
                    <b>{f.username}</b>
                  </td>
                  <td>
                    <CoinIcon size={15} /> {f.coins.toLocaleString()}
                  </td>
                  <td>{f.level}</td>
                  <td>{f.day}</td>
                  <td>{f.animals}</td>
                  <td>{f.playing && <span className="pill live">playing</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No farms saved yet.</p>
        )}
      </div>
    </>
  );
}
