import type { Course, CourseMetrics, MetricsSnapshot, NormalizedDataset } from '../../models.ts';
import { average, clamp, id, ratio, round } from './utils.ts';

export function calculateMetrics(dataset: NormalizedDataset): MetricsSnapshot {
  const courses = dataset.courses.map((course) => calculateCourseMetrics(course, dataset));
  const completedCourses = courses.filter((c) => c.status.toLowerCase() === 'completed');
  const traineeCount = new Set(dataset.trainees.map((t) => `${t.courseId}:${t.employeeId}`)).size;
  const totalCostScaled = courses.reduce((sum, c) => sum + (c.totalCostScaled ?? 0), 0);
  const trainingHours = courses.reduce((sum, c) => sum + c.trainingHours, 0);
  const overall = {
    totalCourses: courses.length,
    completedCourses: completedCourses.length,
    traineeCount,
    attendanceRate: round(weightedAverage(courses, 'attendanceRate', 'traineeCount')),
    completionRate: round(weightedAverage(courses, 'completionRate', 'traineeCount')),
    passRate: round(weightedAverage(courses, 'passRate', 'traineeCount')),
    averageScore: round(weightedAverage(courses, 'averageScore', 'traineeCount'), 2),
    feedbackRating: round(weightedAverage(courses, 'feedbackRating', 'traineeCount'), 2),
    trainingHours: round(trainingHours, 2) ?? 0,
    totalCostScaled: round(totalCostScaled, 2) ?? 0,
    roiProxy: round(average(courses.map((c) => c.roiProxy)), 4),
    effectivenessScore: round(average(courses.map((c) => c.effectivenessScore)), 2),
  };
  return {
    metricsId: id('mx'),
    datasetId: dataset.datasetId,
    generatedAt: new Date().toISOString(),
    overall,
    courses,
  };
}

function calculateCourseMetrics(course: Course, dataset: NormalizedDataset): CourseMetrics {
  const trainees = dataset.trainees.filter((t) => t.courseId === course.courseId);
  const cost = dataset.costs.find((c) => c.courseId === course.courseId);
  const traineeCount = trainees.length;
  const attendanceRate = round(average(trainees.map((t) => t.attendanceRate)));
  const completionRate = round(ratio(trainees.filter((t) => t.completed).length, traineeCount));
  const passRate = round(ratio(trainees.filter((t) => t.passStatus === true).length, traineeCount));
  const averageScore = round(average(trainees.map((t) => t.score)), 2);
  const trainerRatingAvg = round(average(trainees.map((t) => t.trainerRating)), 2);
  const contentRatingAvg = round(average(trainees.map((t) => t.contentRating)), 2);
  const feedbackRating = round(average([trainerRatingAvg, contentRatingAvg]), 2);
  const feedbackResponseRate = round(
    ratio(
      trainees.filter((t) => t.trainerRating !== null || t.contentRating !== null).length,
      traineeCount,
    ),
  );
  const trainingHours =
    round(
      trainees.reduce((sum, t) => sum + t.attendedUnits * course.hoursPerSession, 0),
      2,
    ) ?? 0;
  const totalCostScaled = cost?.totalCostScaled ?? null;
  const costPerCompletedTrainee = round(
    ratio(totalCostScaled ?? 0, Math.max(trainees.filter((t) => t.completed).length, 0)),
    2,
  );
  const postTrainingPerfDelta = cost?.postTrainingPerfDelta ?? null;
  const roiProxy = round(
    calculateRoiProxy(postTrainingPerfDelta, totalCostScaled, traineeCount),
    4,
  );
  const effectivenessScore = round(
    calculateEffectivenessScore({
      attendanceRate,
      completionRate,
      passRate,
      averageScore,
      feedbackRating,
      postTrainingPerfDelta,
    }),
    2,
  );

  return {
    courseId: course.courseId,
    courseName: course.courseName,
    trainerId: course.trainerId || undefined,
    status: course.status,
    traineeCount,
    attendanceRate,
    completionRate,
    passRate,
    averageScore,
    feedbackRating,
    trainerRatingAvg,
    contentRatingAvg,
    feedbackResponseRate,
    trainingHours,
    totalCostScaled,
    costPerCompletedTrainee,
    postTrainingPerfDelta,
    roiProxy,
    effectivenessScore,
  };
}

function calculateEffectivenessScore(input: {
  attendanceRate: number | null;
  completionRate: number | null;
  passRate: number | null;
  averageScore: number | null;
  feedbackRating: number | null;
  postTrainingPerfDelta: number | null;
}): number | null {
  const attendance = input.attendanceRate;
  const completion = input.completionRate;
  const pass = input.passRate;
  const score = input.averageScore === null ? null : input.averageScore / 10;
  const feedback = input.feedbackRating === null ? null : input.feedbackRating / 5;
  const perf =
    input.postTrainingPerfDelta === null ? null : clamp(input.postTrainingPerfDelta / 0.05, 0, 1);

  const parts: Array<[number | null, number]> = [
    [attendance, 0.2],
    [completion, 0.2],
    [pass, 0.25],
    [score, 0.2],
    [feedback, 0.1],
    [perf, 0.05],
  ];
  const available = parts.filter(
    (p): p is [number, number] => p[0] !== null && !Number.isNaN(p[0]),
  );
  if (available.length === 0) return null;
  const weightSum = available.reduce((sum, [, weight]) => sum + weight, 0);
  return (available.reduce((sum, [value, weight]) => sum + value * weight, 0) / weightSum) * 100;
}

function calculateRoiProxy(
  postTrainingPerfDelta: number | null | undefined,
  totalCostScaled: number | null | undefined,
  traineeCount: number,
): number | null {
  if (postTrainingPerfDelta === null || postTrainingPerfDelta === undefined) return null;
  const cost = totalCostScaled ?? 0;
  if (cost <= 0) return null;
  return (postTrainingPerfDelta * Math.max(traineeCount, 1)) / cost;
}

function weightedAverage(
  courses: CourseMetrics[],
  valueKey: keyof CourseMetrics,
  weightKey: keyof CourseMetrics,
): number | null {
  let weightedSum = 0;
  let weightSum = 0;
  for (const course of courses) {
    const value = course[valueKey];
    const weight = course[weightKey];
    if (typeof value !== 'number' || typeof weight !== 'number' || Number.isNaN(value)) continue;
    weightedSum += value * weight;
    weightSum += weight;
  }
  if (weightSum === 0) return null;
  return weightedSum / weightSum;
}
