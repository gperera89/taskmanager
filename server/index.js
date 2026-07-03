require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
	res.json({ status: 'ok' });
});

// Tasks
app.get('/tasks', async (req, res) => {
	const tasks = await prisma.task.findMany();
	res.json(tasks);
});

app.get('/tasks/:id', async (req, res) => {
	const task = await prisma.task.findUnique({ where: { id: req.params.id } });
	if (!task) return res.status(404).json({ error: 'Task not found' });
	res.json(task);
});

app.post('/tasks', async (req, res) => {
	const { title, category, dueDate, projectId } = req.body;
	const task = await prisma.task.create({
		data: { title, category, dueDate: dueDate ? new Date(dueDate) : null, projectId },
	});
	res.status(201).json(task);
});

app.put('/tasks/:id', async (req, res) => {
	const { title, category, dueDate, isCompleted, projectId } = req.body;
	const task = await prisma.task.update({
		where: { id: req.params.id },
		data: {
			title,
			category,
			dueDate: dueDate ? new Date(dueDate) : undefined,
			isCompleted,
			projectId,
		},
	});
	res.json(task);
});

app.delete('/tasks/:id', async (req, res) => {
	await prisma.task.delete({ where: { id: req.params.id } });
	res.status(204).send();
});

// Projects
app.get('/projects', async (req, res) => {
	const projects = await prisma.project.findMany();
	res.json(projects);
});

app.get('/projects/:id', async (req, res) => {
	const project = await prisma.project.findUnique({
		where: { id: req.params.id },
		include: { tasks: true },
	});
	if (!project) return res.status(404).json({ error: 'Project not found' });
	res.json(project);
});

app.post('/projects', async (req, res) => {
	const { name, description } = req.body;
	const project = await prisma.project.create({ data: { name, description } });
	res.status(201).json(project);
});

app.put('/projects/:id', async (req, res) => {
	const { name, description } = req.body;
	const project = await prisma.project.update({
		where: { id: req.params.id },
		data: { name, description },
	});
	res.json(project);
});

app.delete('/projects/:id', async (req, res) => {
	await prisma.project.delete({ where: { id: req.params.id } });
	res.status(204).send();
});

// Routines
app.get('/routines', async (req, res) => {
	const routines = await prisma.routine.findMany();
	res.json(routines);
});

app.get('/routines/:id', async (req, res) => {
	const routine = await prisma.routine.findUnique({ where: { id: req.params.id } });
	if (!routine) return res.status(404).json({ error: 'Routine not found' });
	res.json(routine);
});

app.post('/routines', async (req, res) => {
	const { title, reminderTime } = req.body;
	const routine = await prisma.routine.create({ data: { title, reminderTime } });
	res.status(201).json(routine);
});

app.put('/routines/:id', async (req, res) => {
	const { title, reminderTime, isActive } = req.body;
	const routine = await prisma.routine.update({
		where: { id: req.params.id },
		data: { title, reminderTime, isActive },
	});
	res.json(routine);
});

app.delete('/routines/:id', async (req, res) => {
	await prisma.routine.delete({ where: { id: req.params.id } });
	res.status(204).send();
});

// Habits
app.get('/habits', async (req, res) => {
	const habits = await prisma.habit.findMany();
	res.json(habits);
});

app.get('/habits/:id', async (req, res) => {
	const habit = await prisma.habit.findUnique({ where: { id: req.params.id } });
	if (!habit) return res.status(404).json({ error: 'Habit not found' });
	res.json(habit);
});

app.post('/habits', async (req, res) => {
	const { title } = req.body;
	const habit = await prisma.habit.create({ data: { title } });
	res.status(201).json(habit);
});

app.put('/habits/:id', async (req, res) => {
	const { title, currentStreak, longestStreak, daysSinceLastDone, lastCompletedDate } = req.body;
	const habit = await prisma.habit.update({
		where: { id: req.params.id },
		data: {
			title,
			currentStreak,
			longestStreak,
			daysSinceLastDone,
			lastCompletedDate: lastCompletedDate ? new Date(lastCompletedDate) : undefined,
		},
	});
	res.json(habit);
});

app.delete('/habits/:id', async (req, res) => {
	await prisma.habit.delete({ where: { id: req.params.id } });
	res.status(204).send();
});

app.use((err, req, res, next) => {
	console.error(err);
	res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});
