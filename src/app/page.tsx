import { AuthCard } from '../components/AuthCard';

export default function Home() {
  return (
    <section className="hero">
      <div>
        <div className="kicker">A farm that remembers</div>
        <h1>Sign in once. Your farm follows you.</h1>
        <p className="lead">
          The account you make here is the one you sign into the game with. Every day Diana, Arellah or Arash works the fields, milks the cow or
          sells the harvest, the farm is saved to the server, and you can watch it here as it happens.
        </p>
      </div>
      <AuthCard />
    </section>
  );
}
