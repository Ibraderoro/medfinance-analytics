import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
}

export function Skeleton({ width = '100%', height = '1rem', radius = '8px' }: SkeletonProps) {
  return <div className={styles.skeleton} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}
