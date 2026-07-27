import * as React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}
type DivProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * The base honeycomb "cell": a hairline-bordered translucent panel with a deep
 * soft shadow. One card = one main job. Compose with the sub-parts below.
 * @startingPoint section="Core" subtitle="Honeycomb cell panel with header/content/footer" viewport="700x260"
 */
export function Card(props: DivProps): JSX.Element;
export function CardHeader(props: DivProps): JSX.Element;
export function CardTitle(props: DivProps): JSX.Element;
export function CardDescription(props: DivProps): JSX.Element;
export function CardContent(props: DivProps): JSX.Element;
export function CardFooter(props: DivProps): JSX.Element;
